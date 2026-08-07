// Doručení proti skutečnému HTTP serveru, od události po zápis výsledku.
//
// `WEBHOOK_ALLOW_PRIVATE_TARGETS` se nastavuje PŘED prvním importem, který čte
// konfiguraci: testovací server běží na loopbacku a přísná politika by ho
// (správně) zablokovala. Že blokace funguje, měří `deliver-rebinding.test.ts`;
// tenhle soubor měří to druhé, tedy že úspěšná cesta opravdu dojde až na konec.
process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { encryptEnvelope } from '@mlain/contracts/crypto';
import type { WorkspaceContext } from '@mlain/db';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { deliverWebhook } from './deliver';
import { deliverEventToEndpoint, emitWebhookEvent, fanoutEvent } from './emit';
import { signPayload } from './signature';
import { WEBHOOK_SSRF_POLICY } from '../../net/ssrf';
import { handlers } from '../jobs/queue-handlers';
import type { DeliverJobData } from '../jobs/webhook_deliver';
import { scanDueDeliveries } from '../jobs/webhook_retry';

type Received = { headers: IncomingMessage['headers']; body: string };

let harness: PgHarness;
let server: Server;
let port = 0;
let workspaceId = '';
let ctx: WorkspaceContext;

let received: Received[] = [];
let nextStatus = 200;

const SECRET = `whsec_${Buffer.alloc(32, 5).toString('base64url')}`;

/**
 * `allowHttp` je v produkční politice natvrdo `false` a je to správně: webhooky
 * přenášejí podepsané tajemství a po http by jelo v otevřené podobě. Testovací
 * server ale TLS certifikát nemá, takže se pravidlo pro tenhle jeden soubor
 * dočasně vypne a na konci vrátí.
 *
 * Není to díra v pokrytí: že produkční hodnota JE `false`, tvrdí
 * `net/ssrf.test.ts` samostatným testem a ten běží ve vlastním procesu.
 * Tady se neměří politika, měří se to, co jinak ověřit nejde: že
 * `deliverWebhook` skutečně složí obálku, podepíše ji, odešle a výsledek zapíše.
 */
const originalAllowHttp = WEBHOOK_SSRF_POLICY.allowHttp;

beforeAll(async () => {
  expect(originalAllowHttp, 'produkční politika webhooků musí zakazovat http').toBe(false);
  (WEBHOOK_SSRF_POLICY as { allowHttp: boolean }).allowHttp = true;

  harness = await startPgHarness();

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(nextStatus);
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;

  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  ctx = seeded.ctx;
}, 180_000);

afterAll(async () => {
  (WEBHOOK_SSRF_POLICY as { allowHttp: boolean }).allowHttp = originalAllowHttp;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePools();
  await harness?.stop();
}, 120_000);

async function seedEndpoint(): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    const stored = encryptEnvelope({
      plaintext: SECRET,
      context: 'webhook_secret',
      workspaceId,
    }).stored;
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO webhook_endpoints (id, workspace_id, url, event_types, secret_encrypted)
      VALUES (${uuidv7()}::uuid, ${workspaceId}::uuid, ${`http://127.0.0.1:${port}/hook`},
              ARRAY['contact.created'], ${stored})
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
      occurredAt: new Date('2026-08-01T12:40:00.000Z'),
      data: { contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4' },
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

async function endpointRow(id: string) {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      status: string;
      consecutive_failures: number;
      disabled_reason: string | null;
      last_success_at: Date | null;
    }>(sql`
      SELECT status, consecutive_failures, disabled_reason, last_success_at
        FROM webhook_endpoints WHERE id = ${id}::uuid
    `);
    return rows[0]!;
  });
}

async function clearEndpoints(): Promise<void> {
  await withWorkspace(ctx, (tx) => tx.execute(sql`DELETE FROM webhook_endpoints`));
}

describe('doručení proti skutečnému serveru', () => {
  it('odešle podepsanou obálku a příjemce podpis ověří', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 200;
    const endpointId = await seedEndpoint();
    const { deliveryId, createdAt } = await seedDelivery();

    const outcome = await deliverWebhook({ deliveryId, workspaceId, createdAt });
    expect(outcome.status).toBe('succeeded');
    expect(outcome.responseStatus).toBe(200);
    expect(received).toHaveLength(1);

    const request = received[0]!;
    expect(request.headers['ml-attempt']).toBe('1');
    expect(request.headers['ml-event-type']).toBe('contact.created');
    expect(request.headers['ml-event-id']).toBeTruthy();
    expect(request.headers['ml-delivery-id']).toBe(deliveryId);

    // Ověření podpisu tak, jak ho popisuje dokumentace pro příjemce: z hlavičky
    // se vezme `t`, spočítá se HMAC nad "<t>.<syrové tělo>" a porovná se s `v1`.
    const signature = String(request.headers['ml-signature']);
    const parts = Object.fromEntries(
      signature.split(',').map((p) => p.split('=') as [string, string]),
    );
    expect(signPayload(SECRET, Number(parts.t), request.body)).toBe(parts.v1);

    // Obálka je ta kanonická, včetně api_version a pořadí klíčů.
    expect(Object.keys(JSON.parse(request.body))).toEqual([
      'id',
      'type',
      'api_version',
      'occurred_at',
      'workspace_id',
      'data',
    ]);
    expect(JSON.parse(request.body).occurred_at).toBe('2026-08-01T12:40:00.000Z');

    const endpoint = await endpointRow(endpointId);
    expect(endpoint.consecutive_failures).toBe(0);
    expect(endpoint.last_success_at).not.toBeNull();
    expect(endpoint.status).toBe('active');
  });

  it('neúspěch naplánuje další pokus a zvedne čítač', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 500;
    const endpointId = await seedEndpoint();
    const { deliveryId, createdAt } = await seedDelivery();

    const outcome = await deliverWebhook({ deliveryId, workspaceId, createdAt });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorCode).toBe('http_500');

    const row = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        status: string;
        attempt: number;
        next_attempt_at: Date | null;
      }>(sql`
        SELECT status, attempt, next_attempt_at FROM webhook_deliveries WHERE id = ${deliveryId}::uuid
      `);
      return rows[0]!;
    });
    expect(row.status).toBe('failed');
    expect(row.attempt).toBe(1);
    // Druhý pokus podle tabulky odstupů: 15 s plus minus 20 procent jitteru.
    expect(row.next_attempt_at).not.toBeNull();
    const delayMs = new Date(row.next_attempt_at!).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(10_000);
    expect(delayMs).toBeLessThan(20_000);

    expect((await endpointRow(endpointId)).consecutive_failures).toBe(1);
  });

  it('kritérium 37: 410 Gone endpoint okamžitě deaktivuje a další pokus neplánuje', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 410;
    const endpointId = await seedEndpoint();
    const { deliveryId, createdAt } = await seedDelivery();

    const outcome = await deliverWebhook({ deliveryId, workspaceId, createdAt });
    expect(outcome.status).toBe('abandoned');
    expect(outcome.disabledReason).toBe('endpoint_gone');

    const endpoint = await endpointRow(endpointId);
    expect(endpoint.status).toBe('disabled');
    expect(endpoint.disabled_reason).toBe('endpoint_gone');

    const row = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ next_attempt_at: Date | null }>(sql`
        SELECT next_attempt_at FROM webhook_deliveries WHERE id = ${deliveryId}::uuid
      `);
      return rows[0]!;
    });
    expect(row.next_attempt_at).toBeNull();

    // Deaktivace se zapíše do audit logu jako systémová akce.
    const audit = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        actor_type: string;
        metadata: Record<string, unknown>;
      }>(sql`
        SELECT actor_type, metadata FROM audit_log
         WHERE workspace_id = ${workspaceId}::uuid AND action = 'webhook_endpoint.disabled'
         ORDER BY created_at DESC LIMIT 1
      `);
      return rows[0]!;
    });
    expect(audit.actor_type).toBe('system');
    expect(audit.metadata.reason).toBe('endpoint_gone');
  });

  it('deaktivovaný endpoint už fan-out nepustí', async () => {
    // Endpoint z předchozího testu je disabled, takže na novou událost nesmí
    // vzniknout žádné doručení.
    const eventId = await withWorkspace(ctx, (tx) =>
      emitWebhookEvent(tx, {
        workspaceId,
        type: 'contact.created',
        occurredAt: new Date(),
        data: {},
      }),
    );
    expect((await fanoutEvent(ctx, eventId)).created).toBe(0);
  });
});

/**
 * CÍLENÉ DORUČENÍ, tedy „Poslat testovací událost".
 *
 * Míří na KONKRÉTNÍ endpoint, takže se nesmí ptát, co ten endpoint odebírá.
 * Do 7. 8. šlo i tohle fan-outem a projevovalo se to tím, že tlačítko
 * u endpointu založeného z rozhraní NIKDY NIC nedoručilo.
 */
describe('cílené doručení na jeden endpoint', () => {
  it('dorazí i endpointu, který ten typ neodebírá, a zařadí se do fronty', async () => {
    await clearEndpoints();
    const endpointId = await seedEndpoint();
    // Endpoint odebírá `contact.created`, tedy NIC z toho, co posíláme.
    const subscribed = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ event_types: string[] }>(
        sql`SELECT event_types FROM webhook_endpoints WHERE id = ${endpointId}::uuid`,
      );
      return rows[0]!.event_types;
    });
    expect(subscribed).toEqual(['contact.created']);

    const eventId = await withWorkspace(ctx, (tx) =>
      emitWebhookEvent(tx, {
        workspaceId,
        type: 'webhook.ping',
        occurredAt: new Date(),
        data: { endpoint_id: endpointId },
      }),
    );

    // PROTIDŮKAZ: běžnou cestou by se nedoručilo nic. Bez tohohle řádku by
    // test procházel i tehdy, kdyby cílená cesta jen znovu volala fan-out.
    expect((await fanoutEvent(ctx, eventId)).created).toBe(0);

    const { deliveryId } = await withWorkspace(ctx, (tx) =>
      deliverEventToEndpoint(tx, ctx, { eventId, endpointId }),
    );
    expect(deliveryId, 'cílené doručení nevzniklo').not.toBeNull();

    const row = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        event_type: string;
        status: string;
        endpoint_id: string;
      }>(
        sql`
          SELECT event_type, status, endpoint_id::text AS endpoint_id
            FROM webhook_deliveries WHERE id = ${deliveryId!}::uuid
        `,
      );
      return rows[0]!;
    });
    // Zápis do logu doručení testovací událost potřebuje stejně jako každá jiná:
    // bez něj by po kliknutí nebylo kde hledat výsledek.
    expect(row.event_type).toBe('webhook.ping');
    expect(row.status).toBe('pending');
    expect(row.endpoint_id).toBe(endpointId);

    // A úloha ve frontě, protože podpis i opakování dělá až ona. Přesně tenhle
    // článek u testovací události chyběl: fan-out se nikdy nezařadil.
    const queued = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ data: DeliverJobData }>(sql`
        SELECT data FROM pgboss.job
         WHERE name = 'platform.webhook_deliver'
           AND singleton_key = ${`delivery:${deliveryId}`}
      `);
      return rows;
    });
    expect(queued, 'doručení se nezařadilo do platform.webhook_deliver').toHaveLength(1);
    expect(queued[0]!.data.delivery_id).toBe(deliveryId);
  });

  it('druhé kliknutí nad toutéž událostí druhé doručení nevyrobí', async () => {
    await clearEndpoints();
    const endpointId = await seedEndpoint();
    const eventId = await withWorkspace(ctx, (tx) =>
      emitWebhookEvent(tx, {
        workspaceId,
        type: 'webhook.ping',
        occurredAt: new Date(),
        data: { endpoint_id: endpointId },
      }),
    );

    const first = await withWorkspace(ctx, (tx) =>
      deliverEventToEndpoint(tx, ctx, { eventId, endpointId }),
    );
    const second = await withWorkspace(ctx, (tx) =>
      deliverEventToEndpoint(tx, ctx, { eventId, endpointId }),
    );
    expect(first.deliveryId).not.toBeNull();
    expect(second.deliveryId, 'idempotence je společná s fan-outem, ne zvlášť').toBeNull();
  });
});

/**
 * CELÁ CESTA PŘES FRONTU, ne jen přímé volání `deliverWebhook`.
 *
 * Testy výš volají doručení PŘÍMO, a právě proto zůstala vada tak dlouho
 * neviditelná: byly zelené, zatímco v provozu do fronty `platform.webhook_deliver`
 * nikdo nezařazoval a řádky zůstávaly navždy ve stavu `pending`. Tenhle blok
 * proto nesmí `deliverWebhook` volat sám: bere úlohu z `pgboss.job` a spouští
 * TU OBSLUHU, kterou pouští worker (`platform/jobs/queue-handlers.ts`).
 */
describe('doručení celou cestou přes frontu', () => {
  beforeAll(async () => {
    // Testovací obal zakládá fronty BEZ politiky, kdežto produkce ji posílá
    // z registru (`apps/worker/src/boss.ts`, `queueOptions`). Bez tohohle řádku
    // by se slučování duplicitních doručení nedalo v testu vůbec změřit,
    // protože pro politiku `standard` pg-boss `singletonKey` ignoruje.
    await withWorkspace(ctx, (tx) =>
      tx.execute(
        sql`UPDATE pgboss.queue SET policy = 'exclusive' WHERE name = 'platform.webhook_deliver'`,
      ),
    );
  });

  /** Odklidí zařazené úlohy, aby se další zařazení nemělo s čím sloučit. */
  async function consumeJobs(deliveryId: string): Promise<void> {
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        DELETE FROM pgboss.job
         WHERE name = 'platform.webhook_deliver'
           AND singleton_key = ${`delivery:${deliveryId}`}
      `),
    );
  }

  /** Úlohy fronty doručení pro dané doručení, tak jak leží v tabulce pg-bossu. */
  async function queuedJobs(deliveryId: string): Promise<DeliverJobData[]> {
    return withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ data: DeliverJobData }>(sql`
        SELECT data FROM pgboss.job
         WHERE name = 'platform.webhook_deliver'
           AND singleton_key = ${`delivery:${deliveryId}`}
           AND state <= 'active'
      `);
      return rows.map((row) => row.data);
    });
  }

  async function deliveryRow(deliveryId: string) {
    return withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{
        status: string;
        attempt: number;
        delivered_at: Date | null;
        next_attempt_at: Date | null;
      }>(sql`
        SELECT status, attempt, delivered_at, next_attempt_at
          FROM webhook_deliveries WHERE id = ${deliveryId}::uuid
      `);
      return rows[0]!;
    });
  }

  it('fan-out zařadí doručení a obsluha z registru ho dotáhne do succeeded', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 200;
    await seedEndpoint();
    const { deliveryId } = await seedDelivery();

    // 1. Řádek vzniká ve stavu čekání a fan-out k němu zařadil úlohu.
    expect((await deliveryRow(deliveryId)).status).toBe('pending');
    const jobs = await queuedJobs(deliveryId);
    expect(jobs, 'fan-out nezařadil úlohu do platform.webhook_deliver').toHaveLength(1);
    expect(jobs[0]!.delivery_id).toBe(deliveryId);
    expect(jobs[0]!.workspace_id).toBe(workspaceId);

    // 2. Úlohu zpracuje TÁŽ obsluha, kterou pouští worker.
    await handlers['platform.webhook_deliver']!([{ data: jobs[0]! }] as never);

    // 3. Řádek doručení se pohnul dál a příjemce zprávu dostal.
    const row = await deliveryRow(deliveryId);
    expect(row.status).toBe('succeeded');
    expect(row.attempt).toBe(1);
    expect(row.delivered_at).not.toBeNull();
    expect(received).toHaveLength(1);
  });

  /**
   * Druhá polovina opravy. Fronta doručení má `retryLimit: 0`, protože odstupy
   * mezi pokusy řídí aplikace; bez tohohle skenu by první neúspěch byl poslední.
   */
  it('sken zařadí doručení, jehož next_attempt_at nastal', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 500;
    await seedEndpoint();
    const { deliveryId } = await seedDelivery();

    // První pokus selže a naplánuje další. Úlohu z fan-outu spotřebujeme, aby
    // se sken neměl s čím slučovat a měřil se opravdu on.
    const first = await queuedJobs(deliveryId);
    await handlers['platform.webhook_deliver']!([{ data: first[0]! }] as never);
    await consumeJobs(deliveryId);
    expect((await deliveryRow(deliveryId)).status).toBe('failed');
    expect(await queuedJobs(deliveryId)).toHaveLength(0);

    // Čas dalšího pokusu je podle tabulky odstupů v budoucnosti, takže sken
    // zatím nesmí zařadit nic.
    expect((await scanDueDeliveries()).enqueued).toBe(0);

    // Posun času dalšího pokusu do minulosti dělá totéž co uplynulá čekací doba.
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second'
         WHERE id = ${deliveryId}::uuid
      `),
    );

    expect((await scanDueDeliveries()).enqueued).toBe(1);
    const queued = await queuedJobs(deliveryId);
    expect(queued).toHaveLength(1);

    // A druhý pokus doopravdy dojde, tentokrát na server, který odpoví 200.
    nextStatus = 200;
    await handlers['platform.webhook_deliver']!([{ data: queued[0]! }] as never);
    const row = await deliveryRow(deliveryId);
    expect(row.status).toBe('succeeded');
    expect(row.attempt).toBe(2);
  });

  it('sken přeskočí doručení na vypnutý endpoint', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 500;
    const endpointId = await seedEndpoint();
    const { deliveryId } = await seedDelivery();
    await consumeJobs(deliveryId);

    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        UPDATE webhook_deliveries SET status = 'failed', next_attempt_at = now() - interval '1 minute'
         WHERE id = ${deliveryId}::uuid
      `),
    );
    // Bez tohohle pravidla by vypínání endpointu nemělo žádný účinek: čekající
    // doručení mají čas dalšího pokusu spočítaný a sken by je zařazoval dál.
    await withWorkspace(ctx, (tx) =>
      tx.execute(
        sql`UPDATE webhook_endpoints SET status = 'disabled' WHERE id = ${endpointId}::uuid`,
      ),
    );

    expect((await scanDueDeliveries()).enqueued).toBe(0);
    expect(await queuedJobs(deliveryId)).toHaveLength(0);
  });

  /**
   * Slučování mezi dvěma producenty. Politika `exclusive` se pro tenhle blok
   * nastavuje ručně, protože testovací obal (`test-support/pgboss.ts`) zakládá
   * fronty BEZ politiky, kdežto produkce ji posílá z registru
   * (`apps/worker/src/boss.ts`, `queueOptions`). Ten rozdíl je hlášený zvlášť.
   */
  it('sken nezaloží druhou úlohu k doručení, které už ve frontě leží', async () => {
    await clearEndpoints();
    received = [];
    nextStatus = 200;
    await seedEndpoint();
    const { deliveryId } = await seedDelivery();

    expect(await queuedJobs(deliveryId)).toHaveLength(1);
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second'
         WHERE id = ${deliveryId}::uuid
      `),
    );

    expect((await scanDueDeliveries()).enqueued).toBe(0);
    expect(await queuedJobs(deliveryId)).toHaveLength(1);
  });
});
