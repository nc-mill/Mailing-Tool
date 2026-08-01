import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import {
  RLS_REGISTRY,
  SENDER_BYPASS_TABLES,
  TABLES_WITHOUT_RLS,
  TABLES_WITHOUT_WORKSPACE_ID,
  expectedPolicies,
} from '../src/rls';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

async function allTables(): Promise<string[]> {
  const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        AND c.relispartition = false ORDER BY 1`,
  );
  return rows.map((r) => r.relname);
}

describe('registr RLS proti skutečnému stavu', () => {
  it('každá tabulka mimo whitelist má sloupec workspace_id (kritérium 21e)', async () => {
    for (const table of await allTables()) {
      if (TABLES_WITHOUT_WORKSPACE_ID.includes(table)) continue;
      const { rows } = await h.as('mlain_migrator').query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'workspace_id'`,
        [table],
      );
      expect(rows, `${table} nemá workspace_id a není na whitelistu`).toHaveLength(1);
    }
  });

  it('workspaces je na whitelistu a přesto má zapnuté RLS (kritérium 21e)', async () => {
    expect(TABLES_WITHOUT_WORKSPACE_ID).toContain('workspaces');
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'workspaces'`,
      );
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it('každá tabulka má zapnuté RLS a přesně ty politiky, které říká registr', async () => {
    for (const entry of RLS_REGISTRY) {
      const { rows: rls } = await h
        .as('mlain_migrator')
        .query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
          [entry.table],
        );
      expect(rls[0]?.relrowsecurity, `${entry.table} nemá zapnuté RLS`).toBe(true);

      const { rows: policies } = await h
        .as('mlain_migrator')
        .query<{ policyname: string }>(
          `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY 1`,
          [entry.table],
        );
      expect(policies.map((p) => p.policyname).sort()).toEqual(
        expectedPolicies(entry.table).sort(),
      );
    }
  });

  it('žádná tabulka nemá politiku, která v registru není', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`,
      );
    for (const row of rows) {
      expect(
        expectedPolicies(row.tablename),
        `${row.tablename}.${row.policyname} není v registru`,
      ).toContain(row.policyname);
    }
  });

  it('tabulky bez RLS ho opravdu vypnuté mají', async () => {
    for (const table of TABLES_WITHOUT_RLS) {
      const { rows } = await h
        .as('mlain_migrator')
        .query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
          [table],
        );
      expect(rows[0].relrowsecurity, `${table} má RLS, ale nemá mít`).toBe(false);
    }
  });

  it('sender_bypass existuje na všech osmi tabulkách z registru', async () => {
    for (const table of SENDER_BYPASS_TABLES) {
      const { rows } = await h.as('mlain_migrator').query<{ roles: string[] }>(
        `SELECT roles FROM pg_policies
          WHERE tablename = $1 AND policyname = 'sender_bypass'`,
        [table],
      );
      expect(rows, `${table} nemá politiku sender_bypass`).toHaveLength(1);
      expect(rows[0].roles).toContain('mlain_sender');
    }
  });

  it('celkem existuje 84 politik', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`,
      );
    expect(rows[0].n).toBe(84);
  });
});
