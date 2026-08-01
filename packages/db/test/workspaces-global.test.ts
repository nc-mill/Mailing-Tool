// packages/db/test/workspaces-global.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { unsafeWorkspaceContext } from '../src/unsafe-context';
import { withWorkspace } from '../src/repo/tx';
import { createWorkspaceAsUser, listWorkspacesForUser } from '../src/repo/workspaces-global';
import { listGlobalAuditForUser } from '../src/repo/audit-global';
import { ensureUpcomingPartitions } from '../src/partitions';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // Šablona se migruje s `ensurePartitions: false`, takže `audit_log` nemá
  // ani jeden oddíl a DEFAULT partition se schválně nezakládá. Bez tohohle
  // řádku skončí zápis chybou „no partition of relation audit_log found
  // for row" (ověřeno spuštěním). Oddíly si podle plánu zakládá každý test
  // podle svého data.
  await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('workspaces-global (kritérium 21d)', () => {
  it('výpis pod nastaveným mlain.user_id vrátí jen projekty s členstvím', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const rows = await listWorkspacesForUser(h.as('mlain_app'), ws.userId);
    expect(rows.map((r) => r.id).sort()).toEqual([ws.workspaceA, ws.workspaceB].sort());
  });

  it('pod workspace kontextem vidí aktér PRÁVĚ JEDEN projekt, ten svůj', async () => {
    // Regresní test k reálné vadě, kterou celá sada db přehlédla: politika
    // ws_member_visibility chvíli neměla podmínku, že workspace kontext NENÍ
    // nastavený. Obě politiky na workspaces jsou PERMISSIVE, takže se OR-ují,
    // a withWorkspace u aktéra typu `user` nastavuje oba GUC naráz. Pod
    // kontextem B tedy aktér viděl i projekt A. Únik mezi projekty to není,
    // je členem obou, ale kritérium 21d čekalo právě jeden řádek.
    //
    // Ostatní testy v tomhle souboru jedou přes withUser, tedy BEZ workspace
    // kontextu, takže na tuhle větev ani jeden z nich nedosáhne.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, {
      type: 'user',
      userId: ws.userId,
      role: 'owner',
    });
    const videne = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM workspaces`);
      return rows.map((r) => r.id);
    });
    expect(videne).toEqual([ws.workspaceB]);
    expect(videne, 'pod kontextem B nesmí být vidět projekt A').not.toContain(ws.workspaceA);
  });

  it('výpis pro cizího uživatele vrátí 0 řádků', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const rows = await listWorkspacesForUser(
      h.as('mlain_app'),
      '01930000-0000-7000-8000-000000000000',
    );
    expect(rows).toHaveLength(0);
  });

  it('založení projektu bez mlain.user_id selže na WITH CHECK', async () => {
    await expect(
      h.as('mlain_app').query(
        `INSERT INTO workspaces (name, slug, locale, timezone)
         VALUES ('x', 'no-context-ws', 'cs', 'Europe/Prague')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('založení projektu s nastaveným mlain.user_id projde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const created = await createWorkspaceAsUser(h.as('mlain_app'), ws.userId, {
      name: 'Nový projekt',
      slug: `novy-${Date.now()}`,
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
    expect(created.id).toBeTruthy();
  });
});

describe('audit-global', () => {
  it('vrací jen řádky, jejichž actor_id je ten uživatel', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const other = '01930000-0000-7000-8000-0000000000ff';
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES (NULL, 'user', $1, 'user.password_changed'),
              (NULL, 'user', $2, 'user.password_changed')`,
      [ws.userId, other],
    );
    const rows = await listGlobalAuditForUser(h.as('mlain_app'), ws.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('user.password_changed');
  });
});
