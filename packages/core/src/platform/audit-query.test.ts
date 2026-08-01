import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { WorkspaceContext } from '@mlain/db';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { writeAuditLog } from '../audit/write';
import { IdentityAuditActions } from '../identity/audit';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { AUDIT_ORDERS, countAuditLog, listAuditLog } from './audit-query';

let harness: PgHarness;
let workspaceId = '';
let userId = '';
let workspaceCtx: WorkspaceContext;

beforeAll(async () => {
  harness = await startPgHarness();
  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  userId = seeded.userId;
  workspaceCtx = seeded.ctx;

  await withWorkspace(workspaceCtx, async (tx) => {
    for (const action of [
      IdentityAuditActions['workspace.updated'],
      IdentityAuditActions['api_key.created'],
      IdentityAuditActions['api_key.revoked'],
    ]) {
      await writeAuditLog(tx, {
        action,
        workspaceId,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        targetType: 'workspace',
        targetId: workspaceId,
      });
    }
  });
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const ctx = () => workspaceCtx;

describe('listAuditLog', () => {
  it('povolené řazení je vyjmenované', () => {
    expect(AUDIT_ORDERS).toEqual(['created_at.desc', 'created_at.asc']);
  });

  it('vrátí záznamy projektu, nejnovější první', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 50, order: 'created_at.desc', cursor: null }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const times = rows.map((r) => new Date(r.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filtr podle action zabírá', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), {
        limit: 50,
        order: 'created_at.desc',
        cursor: null,
        action: 'api_key.created',
      }),
    );
    expect(rows.every((r) => r.action === 'api_key.created')).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('filtr podle actor_id zabírá', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), {
        limit: 50,
        order: 'created_at.desc',
        cursor: null,
        actorId: userId,
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.actor_id === userId)).toBe(true);
  });

  it('filtry from a to zabírají', async () => {
    const budoucnost = new Date(Date.now() + 60_000).toISOString();
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), {
        limit: 50,
        order: 'created_at.desc',
        cursor: null,
        from: budoucnost,
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it('načítá limit + 1 řádků, aby šlo odvodit has_more', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 2, order: 'created_at.desc', cursor: null }),
    );
    expect(rows.length).toBe(3);
  });

  it('řazení created_at.asc obrací pořadí', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 50, order: 'created_at.asc', cursor: null }),
    );
    const times = rows.map((r) => new Date(r.created_at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('countAuditLog', () => {
  it('vrátí přesný počet se stejnými filtry jako seznam', async () => {
    const result = await withWorkspace(workspaceCtx, (tx) =>
      countAuditLog(tx, ctx(), { action: 'api_key.created' }),
    );
    expect(result.count).toBe(1);
    expect(result.precision).toBe('exact');
    expect(result.stale).toBe(false);
  });
});
