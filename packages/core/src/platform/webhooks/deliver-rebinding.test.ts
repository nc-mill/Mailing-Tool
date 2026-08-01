import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { encryptEnvelope } from '@mlain/contracts/crypto';
import type { WorkspaceContext } from '@mlain/db';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { deliverWebhook } from './deliver';
import { fanoutEvent, emitWebhookEvent } from './emit';

/**
 * Doplněno nad rámec plánu, na výslovný požadavek: ochrana proti SSRF se musí
 * dát ZMĚŘIT na celé cestě doručení, ne jen v jednotkovém testu klienta.
 *
 * Scénář je DNS rebinding, tedy přesně ta díra, kterou kontrola při ukládání
 * zavřít neumí: endpoint se do databáze dostane s jménem, které v té chvíli
 * mířilo ven, a teprve při doručení se přeloží na loopback. Řádek se proto
 * vkládá přímo SQL, ne přes `createEndpoint`; ta by ho odmítla už při zápisu
 * a test by pak dokazoval něco jiného, než tvrdí.
 *
 * Na loopbacku běží živý HTTP server, který si počítá požadavky. Důkazem není
 * hlášená chyba, ale jeho netknutý čítač.
 */
let harness: PgHarness;
let server: Server;
let port = 0;
let hits = 0;
let workspaceId = '';
let ctx: WorkspaceContext;

beforeAll(async () => {
  harness = await startPgHarness();

  server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(200);
    res.end('nemel jsem nic dostat');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;

  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  ctx = seeded.ctx;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePools();
  await harness?.stop();
}, 120_000);

async function seedEndpoint(url: string): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    const stored = encryptEnvelope({
      plaintext: 'whsec_' + Buffer.alloc(32, 3).toString('base64url'),
      context: 'webhook_secret',
      workspaceId,
    }).stored;
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO webhook_endpoints (id, workspace_id, url, event_types, secret_encrypted)
      VALUES (${uuidv7()}::uuid, ${workspaceId}::uuid, ${url}, ARRAY['contact.created'], ${stored})
      RETURNING id::text AS id
    `);
    return rows[0]!.id;
  });
}

async function seedDelivery(): Promise<{ deliveryId: string; createdAt: Date }> {
  const eventId = await withWorkspace(ctx, (tx) =>
    emitWebhookEvent(tx, {
      workspaceId,
      type: 'contact.created',
      occurredAt: new Date(),
      data: { contact_id: uuidv7() },
    }),
  );
  const result = await fanoutEvent(ctx, eventId);
  expect(result.created).toBe(1);
  const deliveryId = result.deliveryIds[0]!;
  const createdAt = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ created_at: Date }>(sql`
      SELECT created_at FROM webhook_deliveries WHERE id = ${deliveryId}::uuid
    `);
    return new Date(rows[0]!.created_at);
  });
  return { deliveryId, createdAt };
}

describe('kritérium 39: doručení na privátní rozsah se neprovede', () => {
  it('endpoint se jménem, které se přeloží na loopback, skončí na blocked_target a server nic nedostane', async () => {
    await seedEndpoint(`https://localhost:${port}/hook`);
    const { deliveryId, createdAt } = await seedDelivery();

    const before = hits;
    const outcome = await deliverWebhook({ deliveryId, workspaceId, createdAt });

    expect(outcome.errorCode).toBe('blocked_target');
    // Trvalá chyba konfigurace, takže žádné retry: doručení je rovnou vzdané.
    expect(outcome.status).toBe('abandoned');
    expect(hits, 'server na loopbacku nesměl dostat ani jeden požadavek').toBe(before);

    const row = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        status: string;
        error_code: string;
        next_attempt_at: Date | null;
      }>(sql`
        SELECT status, error_code, next_attempt_at FROM webhook_deliveries WHERE id = ${deliveryId}::uuid
      `);
      return rows[0]!;
    });
    expect(row.status).toBe('abandoned');
    expect(row.error_code).toBe('blocked_target');
    expect(row.next_attempt_at).toBeNull();
  });

  it('literální privátní adresa v uloženém endpointu se taky nedoručí', async () => {
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`UPDATE webhook_endpoints SET status = 'active', consecutive_failures = 0`),
    );
    await withWorkspace(ctx, (tx) => tx.execute(sql`DELETE FROM webhook_endpoints`));
    await seedEndpoint(`https://127.0.0.1:${port}/hook`);
    const { deliveryId, createdAt } = await seedDelivery();

    const before = hits;
    const outcome = await deliverWebhook({ deliveryId, workspaceId, createdAt });

    expect(outcome.errorCode).toBe('blocked_target');
    expect(hits).toBe(before);
  });
});

describe('fan-out je idempotentní', () => {
  it('druhý běh nad toutéž událostí nevytvoří druhou sadu doručení', async () => {
    await withWorkspace(ctx, (tx) => tx.execute(sql`DELETE FROM webhook_endpoints`));
    await seedEndpoint('https://example.com/hook');

    const eventId = await withWorkspace(ctx, (tx) =>
      emitWebhookEvent(tx, {
        workspaceId,
        type: 'contact.created',
        occurredAt: new Date(),
        data: {},
      }),
    );

    const first = await fanoutEvent(ctx, eventId);
    const second = await fanoutEvent(ctx, eventId);

    expect(first.created).toBe(1);
    expect(second.created, 'druhý běh jobu nesmí vyrobit další doručení').toBe(0);

    const count = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ c: string }>(sql`
        SELECT count(*) AS c FROM webhook_deliveries WHERE event_id = ${eventId}::uuid
      `);
      return Number(rows[0]!.c);
    });
    expect(count).toBe(1);
  });
});
