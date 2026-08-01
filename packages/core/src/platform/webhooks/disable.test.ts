import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { WorkspaceContext } from '@mlain/db';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { applyDeliveryOutcome, DISABLE_AFTER_FAILURES, shouldDisable } from './disable';

let harness: PgHarness;
let workspaceId = '';
let workspaceCtx: WorkspaceContext;
let endpointId = '';

/**
 * Doručení musí mít `created_at` shodné s událostí: je to partiční klíč
 * i druhá složka klíče události (rozhodnutí R22 v P03). DEFAULT now() sloupec
 * schválně nemá, takže se hodnota předává výslovně.
 */
async function makeDelivery(): Promise<{ id: string; createdAt: Date }> {
  const id = uuidv7();
  const createdAt = new Date();
  await withWorkspace(workspaceCtx, async (tx) => {
    const eventId = uuidv7();
    await tx.execute(sql`
      INSERT INTO webhook_events (id, workspace_id, type, payload, occurred_at)
      VALUES (${eventId}::uuid, ${workspaceId}::uuid, 'contact.created', '{}'::jsonb, now())
    `);
    await tx.execute(sql`
      INSERT INTO webhook_deliveries
        (id, workspace_id, endpoint_id, event_id, event_type, status, attempt, created_at)
      VALUES (${id}::uuid, ${workspaceId}::uuid, ${endpointId}::uuid, ${eventId}::uuid,
              'contact.created', 'pending', 0, ${createdAt})
    `);
  });
  return { id, createdAt };
}

async function endpointRow(): Promise<{
  status: string;
  consecutive_failures: number;
  disabled_reason: string | null;
}> {
  return withWorkspace(workspaceCtx, async (tx) => {
    const { rows } = await tx.execute<{
      status: string;
      consecutive_failures: number;
      disabled_reason: string | null;
    }>(sql`
      SELECT status, consecutive_failures, disabled_reason FROM webhook_endpoints WHERE id = ${endpointId}::uuid
    `);
    return rows[0]!;
  });
}

beforeAll(async () => {
  harness = await startPgHarness();
  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  workspaceCtx = seeded.ctx;
  endpointId = await withWorkspace(workspaceCtx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO webhook_endpoints (workspace_id, url, event_types, secret_encrypted)
      VALUES (${workspaceId}::uuid, 'https://example.com/hook', ARRAY['contact.created'], 'enc:v1:x')
      RETURNING id::text AS id
    `);
    return rows[0]!.id;
  });
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('shouldDisable', () => {
  it('mez je 20 neúspěšných pokusů podle 3.8', () => {
    expect(DISABLE_AFTER_FAILURES).toBe(20);
  });

  it('19 neúspěchů endpoint nevypne', () => {
    expect(
      shouldDisable({
        consecutiveFailures: 19,
        lastSuccessAt: new Date(),
        attemptsSinceSuccess: 19,
      }),
    ).toBeNull();
  });

  it('kritérium 40: 20 neúspěchů po sobě endpoint vypne', () => {
    expect(
      shouldDisable({ consecutiveFailures: 20, lastSuccessAt: null, attemptsSinceSuccess: 20 }),
    ).toBe('too_many_failures');
  });

  it('žádný úspěch 72 hodin při aspoň 10 pokusech taky vypne', () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000);
    expect(
      shouldDisable({ consecutiveFailures: 12, lastSuccessAt: old, attemptsSinceSuccess: 12 }),
    ).toBe('no_success_72h');
  });

  it('žádný úspěch 72 hodin při méně než 10 pokusech nevypne', () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000);
    expect(
      shouldDisable({ consecutiveFailures: 3, lastSuccessAt: old, attemptsSinceSuccess: 3 }),
    ).toBeNull();
  });
});

describe('applyDeliveryOutcome', () => {
  it('úspěch vynuluje čítač a zapíše last_success_at', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'succeeded',
      responseStatus: 200,
      snippet: 'ok',
      durationMs: 12,
      errorCode: null,
      nextAttemptAt: null,
      disableReason: null,
    });
    const row = await endpointRow();
    expect(row.consecutive_failures).toBe(0);
    expect(row.status).toBe('active');
  });

  it('neúspěch zvýší čítač o jedna za KAŽDÝ pokus, ne za doručení', async () => {
    const before = (await endpointRow()).consecutive_failures;
    const delivery = await makeDelivery();
    for (const attempt of [1, 2, 3]) {
      await applyDeliveryOutcome({
        workspaceId,
        deliveryId: delivery.id,
        createdAt: delivery.createdAt,
        endpointId,
        attempt,
        status: 'failed',
        responseStatus: 500,
        snippet: 'chyba',
        durationMs: 30,
        errorCode: 'http_500',
        nextAttemptAt: new Date(Date.now() + 15_000),
        disableReason: null,
      });
    }
    expect((await endpointRow()).consecutive_failures).toBe(before + 3);
  });

  it('kritérium 37: disableReason endpoint okamžitě vypne', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'abandoned',
      responseStatus: 410,
      snippet: '',
      durationMs: 5,
      errorCode: 'http_410',
      nextAttemptAt: null,
      disableReason: 'endpoint_gone',
    });
    const row = await endpointRow();
    expect(row.status).toBe('disabled');
    expect(row.disabled_reason).toBe('endpoint_gone');
  });

  it('response_body_snippet se ořízne na 2 kB', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'failed',
      responseStatus: 500,
      snippet: 'x'.repeat(5000),
      durationMs: 5,
      errorCode: 'http_500',
      nextAttemptAt: null,
      disableReason: null,
    });
    const rows = await withWorkspace(workspaceCtx, async (tx) => {
      const r = await tx.execute<{ len: number }>(sql`
        SELECT length(response_body_snippet) AS len FROM webhook_deliveries WHERE id = ${delivery.id}::uuid
      `);
      return r.rows;
    });
    expect(rows[0]!.len).toBeLessThanOrEqual(2048);
  });
});
