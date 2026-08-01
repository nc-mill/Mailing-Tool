import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { appPool, closePools, pgErrorCode, withoutContext, withWorkspace } from '../tx';
import { createWorkspaceContext } from '../identity/context';
import { hashPassword } from '../identity/password';
import { IdentityAuditActions } from '../identity/audit';
import { writeAuditLog } from './write';

let harness: PgHarness;
let userId = '';
let wsA = '';
let wsB = '';
let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;

beforeAll(async () => {
  // `audit_log` je partitionovaná podle `created_at` a výchozí partition je
  // podle P03 záměrně zakázaná, takže bez oddílu pro aktuální měsíc by KAŽDÝ
  // zápis do audit logu skončil na „no partition of relation audit_log found".
  // Harness zakládá oddíly ve výchozím stavu (`partitions: true`), takže se tu
  // nic ručně dělat nemusí. Tenhle soubor je zároveň pojistka: kdyby někdo tu
  // výchozí hodnotu překlopil, spadne to tady hlasitě.
  harness = await startPgHarness();

  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: `audit-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  // Zakládá se hotovou funkcí z @mlain/db, protože jen ta nastaví kontext dřív,
  // než vznikne řádek. Dřívější hromadný INSERT ... RETURNING sem nepatří:
  // bez kontextu ho RLS nepustí a členství neprojde přes WITH CHECK.
  const a = await createWorkspaceAsUser(appPool(), userId, {
    name: 'A',
    slug: `au-a-${Date.now()}`,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  const b = await createWorkspaceAsUser(appPool(), userId, {
    name: 'B',
    slug: `au-b-${Date.now()}`,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  wsA = a.id;
  wsB = b.id;
  ctxA = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsA });
  ctxB = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsB });
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('kritérium 21b: globální auditní řádek', () => {
  it('INSERT s workspace_id = NULL projde BEZ nastaveného workspace kontextu', async () => {
    await expect(
      withoutContext((tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['user.password_changed'],
          workspaceId: null,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
          requestId: 'test-request-1',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('transakce se kvůli auditu nerollbackne, takže doprovodná změna platí', async () => {
    const marker = `Jmeno-${Date.now()}`;
    await withoutContext(async (tx) => {
      await tx.execute(sql`UPDATE users SET name = ${marker} WHERE id = ${userId}::uuid`);
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.password_changed'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
      });
    });
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ name: string }>(
        sql`SELECT name FROM users WHERE id = ${userId}::uuid`,
      );
      return result.rows;
    });
    expect(rows[0]!.name).toBe(marker);
  });

  it('INSERT s workspace_id = NULL projde i pod nastaveným kontextem', async () => {
    await expect(
      withWorkspace(ctxA, (tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['user.login'],
          workspaceId: null,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('INSERT s cizím workspace_id pod kontextem B selže na WITH CHECK', async () => {
    // ODCHYLKA OD PLÁNU, stejná jako v identity/isolation.test.ts. Plán psal
    // `rejects.toThrow(/row-level security/)`, jenže `toThrow` porovnává
    // `error.message`, a tam je Drizzlem zabalené „Failed query: insert into
    // audit_log ...". Skutečná hláška z Postgresu je až na `error.cause.message`
    // a SQLSTATE na `error.cause.code`. Test by tedy padal i při plně funkční
    // RLS. Čte se proto SQLSTATE přes `pgErrorCode`, jak plán sám v 0.6 nařizuje.
    let caught: unknown;
    try {
      await withWorkspace(ctxB, (tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['workspace.updated'],
          workspaceId: wsA,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught, 'zápis cizího workspace_id měl selhat na WITH CHECK').toBeDefined();
    expect(pgErrorCode(caught)).toBe('42501');
    expect(String((caught as { cause?: { message?: string } }).cause?.message)).toMatch(
      /row-level security|new row violates/i,
    );
  });
});

describe('kritérium 21c: čtení audit logu je projektové', () => {
  it('pod kontextem B nevrátí čtení ani řádek workspace A, ani globální řádek', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['workspace.updated'],
        workspaceId: wsA,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
      }),
    );
    const rows = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute<{ workspace_id: string | null }>(
        sql`SELECT workspace_id FROM audit_log`,
      );
      return result.rows;
    });
    expect(rows.every((r) => r.workspace_id === wsB)).toBe(true);
    expect(rows.some((r) => r.workspace_id === null)).toBe(false);
    expect(rows.some((r) => r.workspace_id === wsA)).toBe(false);
  });
});

describe('obsah auditního záznamu', () => {
  it('metadata jsou zredigovaná', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['api_key.created'],
        workspaceId: wsA,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        metadata: { name: 'CI klíč', secret: 'ml_live_tajemstvi' },
      }),
    );
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute<{ metadata: Record<string, unknown> }>(
        sql`SELECT metadata FROM audit_log WHERE action = 'api_key.created' ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows;
    });
    expect(rows[0]!.metadata).toEqual({ name: 'CI klíč', secret: '[redacted]' });
  });

  it('actor_label je zmrazený text, ne odkaz', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['member.removed'],
        workspaceId: wsA,
        actor: { actorType: 'api_key', actorId: null, actorLabel: 'Klíč pro CI' },
      }),
    );
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute<{
        actor_type: string;
        actor_id: string | null;
        actor_label: string;
      }>(
        sql`SELECT actor_type, actor_id, actor_label FROM audit_log WHERE action = 'member.removed' ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows;
    });
    expect(rows[0]).toMatchObject({
      actor_type: 'api_key',
      actor_id: null,
      actor_label: 'Klíč pro CI',
    });
  });
});
