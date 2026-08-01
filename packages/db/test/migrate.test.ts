import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_ADVISORY_LOCK_ID, runMigrations } from '../src/migrate';
import { type Harness, startHarness } from './helpers/container';

let h: Harness;
// migrate: false je zde POVINNÉ. Migrační runner je do úkolu 5 zaslepený
// a soubor migrations/meta/_journal.json ještě neexistuje. Kdyby se harness
// pokusil migrovat, výjimka v beforeAll shodí CELÝ soubor, ne jeden test.
beforeAll(async () => {
  h = await startHarness({ migrate: false });
}, 120_000);
afterAll(async () => {
  await h.stop();
});

describe('testovací harness', () => {
  it('otevře spojení pod všemi šesti rolemi a každé hlásí svou roli', async () => {
    const roles = [
      'mlain_migrator',
      'mlain_app',
      'mlain_sender',
      'mlain_gdpr',
      'mlain_maintenance',
      'mlain_backup',
    ] as const;
    for (const role of roles) {
      const { rows } = await h.as(role).query('SELECT current_user AS who');
      expect(rows[0].who).toBe(role);
    }
  });

  it('mlain_migrator vlastní schéma public', async () => {
    const { rows } = await h
      .as('mlain_migrator')
      .query(`SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'public'`);
    expect(rows[0].owner).toBe('mlain_migrator');
  });

  it('každé spojení běží v UTC bez ohledu na časovou zónu databáze', async () => {
    // Databáze je schválně nastavená na Europe/Prague (viz global-setup.ts),
    // aby test dokázal, že UTC vynucuje SPOJENÍ, ne server. Kdyby se ptal
    // databáze nastavené na UTC, nemohl by spadnout nikdy.
    for (const role of ['mlain_app', 'mlain_sender'] as const) {
      const { rows } = await h.as(role).query<{ TimeZone: string }>('SHOW timezone');
      expect(rows[0].TimeZone, `${role} neběží v UTC`).toBe('UTC');
    }
  });
});

function fixtureMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mlain-mig-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = Object.keys(files)
    .sort()
    .map((tag, idx) => ({
      idx,
      version: '7',
      when: 1_800_000_000_000 + idx,
      tag,
      breakpoints: true,
    }));
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2),
  );
  for (const [tag, sql] of Object.entries(files)) {
    writeFileSync(join(dir, `${tag}.sql`), sql);
  }
  return dir;
}

describe('migrační runner', () => {
  it('konstanta advisory locku je pevná a nesmí se měnit', () => {
    expect(MIGRATION_ADVISORY_LOCK_ID).toBe(7264150401);
  });

  it('aplikuje migrace v pořadí z _journal.json a zapíše je do drizzle.__drizzle_migrations', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({
        '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
        '0001_b': 'CREATE TABLE t_b (a_id int REFERENCES t_a(id));',
      });
      await runMigrations({
        url: t.urlFor('mlain_migrator'),
        migrationsFolder: dir,
        ensurePartitions: false,
      });
      const { rows } = await t
        .as('mlain_migrator')
        .query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
      expect(rows[0].n).toBe(2);
    } finally {
      await t.stop();
    }
  });

  it('tři souběžné běhy aplikují každou migraci právě jednou (kritérium 4)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({
        '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
        '0001_b': 'CREATE TABLE t_b (id int PRIMARY KEY);',
      });
      const url = t.urlFor('mlain_migrator');
      const opts = { url, migrationsFolder: dir, ensurePartitions: false };
      await Promise.all([runMigrations(opts), runMigrations(opts), runMigrations(opts)]);
      const { rows } = await t
        .as('mlain_migrator')
        .query(`SELECT hash, count(*)::int AS n FROM drizzle.__drizzle_migrations GROUP BY hash`);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.n).toBe(1);
    } finally {
      await t.stop();
    }
  });

  it('opakovaný běh nad hotovou databází neudělá nic (kritérium 5)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      const opts = {
        url: t.urlFor('mlain_migrator'),
        migrationsFolder: dir,
        ensurePartitions: false,
      };
      await runMigrations(opts);
      await runMigrations(opts);
      const { rows } = await t
        .as('mlain_migrator')
        .query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
      expect(rows[0].n).toBe(1);
    } finally {
      await t.stop();
    }
  });

  it('migrace s -- mlain:no-transaction běží mimo transakci', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({
        '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
        // CREATE INDEX CONCURRENTLY uvnitř transakce skončí chybou 25001.
        '0001_c':
          '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t_a ON t_a (id);',
      });
      await expect(
        runMigrations({
          url: t.urlFor('mlain_migrator'),
          migrationsFolder: dir,
          ensurePartitions: false,
        }),
      ).resolves.toBeUndefined();
    } finally {
      await t.stop();
    }
  });

  it('spadlá migrace vrátí MigrationError s exit code 3 a názvem migrace', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_bad': 'CREATE TABLE (;' });
      await expect(
        runMigrations({
          url: t.urlFor('mlain_migrator'),
          migrationsFolder: dir,
          ensurePartitions: false,
        }),
      ).rejects.toMatchObject({ exitCode: 3, tag: '0000_bad' });
    } finally {
      await t.stop();
    }
  });

  it('schema_version vyšší, než runner zná, skončí exit code 5 (kritérium 13)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      const opts = {
        url: t.urlFor('mlain_migrator'),
        migrationsFolder: dir,
        ensurePartitions: false,
      };
      await runMigrations(opts);
      await t.as('mlain_migrator').query(`
        CREATE TABLE system_settings (
          id boolean PRIMARY KEY DEFAULT true,
          schema_version integer NOT NULL,
          settings jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now())`);
      await t
        .as('mlain_migrator')
        .query(`INSERT INTO system_settings (id, schema_version) VALUES (true, 999)`);
      await expect(runMigrations(opts)).rejects.toMatchObject({
        exitCode: 5,
        code: 'schema_version_ahead',
      });
    } finally {
      await t.stop();
    }
  });

  it('změna obsahu už aplikované migrace skončí exit code 6, ne tichým přehráním', async () => {
    // Bez téhle kontroly stačí přidat mezeru do vydané migrace a runner ji
    // pustí ZNOVU nad hotovým schématem, protože se řídí hashem obsahu.
    // U CREATE TABLE to spadne hlasitě, u GRANT nebo INSERT tiše projde.
    const t = await startHarness({ migrate: false });
    try {
      const opts = (dir: string) => ({
        url: t.urlFor('mlain_migrator'),
        migrationsFolder: dir,
        ensurePartitions: false,
      });
      const first = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      await runMigrations(opts(first));
      const edited = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);\n' });
      await expect(runMigrations(opts(edited))).rejects.toMatchObject({
        exitCode: 6,
        code: 'migration_hash_mismatch',
        tag: '0000_a',
      });
    } finally {
      await t.stop();
    }
  });

  it('neúspěšná migrace ZVÝŠÍ čítač v settings, i když je settings prázdný objekt', async () => {
    // jsonb_set nad prázdným objektem cestu nevytvoří a vrátí původní hodnotu,
    // takže původní tvar čítače by zůstal navždy na nule a pravidlo
    // „po třech neúspěších režim údržby" by bylo neproveditelné.
    const t = await startHarness({ migrate: false });
    try {
      await t.as('mlain_migrator').query(`
        CREATE TABLE system_settings (
          id boolean PRIMARY KEY DEFAULT true,
          schema_version integer NOT NULL,
          settings jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now())`);
      await t
        .as('mlain_migrator')
        .query(`INSERT INTO system_settings (id, schema_version) VALUES (true, 0)`);

      const dir = fixtureMigrations({ '0000_bad': 'CREATE TABLE (;' });
      const opts = {
        url: t.urlFor('mlain_migrator'),
        migrationsFolder: dir,
        ensurePartitions: false,
      };
      await expect(runMigrations(opts)).rejects.toMatchObject({ exitCode: 3 });
      await expect(runMigrations(opts)).rejects.toMatchObject({ exitCode: 3 });

      const { rows } = await t.as('mlain_migrator').query<{ n: number }>(
        `SELECT (settings #>> ARRAY['migration_failures','0000_bad'])::int AS n
           FROM system_settings WHERE id = true`,
      );
      expect(rows[0].n).toBe(2);
    } finally {
      await t.stop();
    }
  });
});
