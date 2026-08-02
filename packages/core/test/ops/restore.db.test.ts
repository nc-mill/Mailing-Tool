import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { runBackup } from '../../src/ops/backup';
import { readManifest, writeManifest } from '../../src/ops/backup-manifest';
import { RestoreRefusedError, restoreBackup } from '../../src/ops/restore';

let pg: TestPostgres;
let backupDir: string;

const base = () => ({
  backupDir,
  databaseUrl: pg.ownerUrl,
  uploadsDir: '/tmp/mlain-restore-uploads',
  appVersion: '1.0.0',
  currentFingerprint: 'VXGoNjoPSBY',
});

beforeAll(async () => {
  pg = await startTestPostgres();
  const root = await mkdtemp(join(tmpdir(), 'mlain-restore-'));
  await pg.seedMinimalInstallation({ contacts: 4 });
  backupDir = (
    await runBackup({
      databaseUrl: pg.ownerUrl,
      backupDir: join(root, 'backups'),
      uploadsDir: join(root, 'nic'),
      appVersion: '1.0.0',
      secretKeyFingerprint: 'VXGoNjoPSBY',
      now: new Date(),
    })
  ).dir;
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

/** Spojení otevřené AŽ TEĎ, tedy po případném přehození schématu public. */
async function freshAppClient(): Promise<Client> {
  const client = new Client({ connectionString: pg.urlForRole('mlain_app') });
  await client.connect();
  return client;
}

describe('restoreBackup', () => {
  it('do neprázdné databáze bez --force skončí chybou a nic nezmění (kritérium 11)', async () => {
    const before = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    await expect(restoreBackup({ ...base(), force: false })).rejects.toThrow(RestoreRefusedError);
    const after = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    expect(after[0]!.n).toBe(before[0]!.n);
  }, 180000);

  it('zálohu z novější verze odmítne s backup_from_newer_version (kritérium 12)', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, { ...manifest, app_version: '2.0.0' });
    const err = await restoreBackup({ ...base(), force: true }).catch((e: Error) => e);
    expect(String(err)).toContain('backup_from_newer_version');
    await writeManifest(backupDir, manifest);
  }, 180000);

  it('při neshodě otisku klíče vyžaduje --i-know-the-key-differs', async () => {
    const err = await restoreBackup({
      ...base(),
      currentFingerprint: 'jinyOtisk1',
      force: true,
    }).catch((e: Error) => e);
    expect(String(err)).toContain('--i-know-the-key-differs');
  }, 180000);

  it('poškozený dump odmítne dřív, než sáhne na databázi', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      database: { ...manifest.database, sha256: '0'.repeat(64) },
    });
    await expect(restoreBackup({ ...base(), force: true })).rejects.toThrow(RestoreRefusedError);
    await writeManifest(backupDir, manifest);
  }, 180000);

  it('s --force obnoví data a vrátí shodné počty', async () => {
    await pg.sql(
      `INSERT INTO contacts (id, workspace_id, email, source, locale, timezone)
       SELECT gen_random_uuid(), id, 'navic@example.com', 'manual', 'cs', 'Europe/Prague'
         FROM workspaces LIMIT 1`,
    );
    const report = await restoreBackup({ ...base(), force: true });
    expect(report.rowCountDiffs).toEqual([]);
    const rows = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    expect(rows[0]!.n).toBe('4');
  }, 180000);

  it('zapíše do auditu akci backup.restored', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.restored'",
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 180000);

  // -------------------------------------------------------------------------
  // Tenhle test je důvod, proč obnova volá mlain_apply_grants().
  //
  // Ptá se APLIKAČNÍ role, ne migrátora. Pod migrátorem projde i databáze,
  // ve které nemá aplikace žádná práva, takže by celý soubor mohl svítit
  // zeleně nad instalací, která po obnově nenastartuje.
  //
  // Ověřeno spuštěním, že bez toho volání to skutečně padá:
  //   ERROR: permission denied for table contacts
  // -------------------------------------------------------------------------
  it('po obnově má aplikační role práva, tedy granty se vrátily', async () => {
    await restoreBackup({ ...base(), force: true });
    // ČERSTVÉ spojení, ne spojení z poolu. `--force` zahodí a znovu založí
    // schéma `public`, a sezení otevřená PŘED tím si drží OID starého
    // schématu ze `search_path`, takže by nad ním viděla „relation does not
    // exist". Není to vada obnovy: `mlain restore` se dělá po havárii,
    // tedy se zastavenou aplikací, a `mlain upgrade` běžící procesy rovnou
    // odmítá. Test to jen nesmí měřit přes zastaralé sezení.
    const client = await freshAppClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [
        (await pg.sql<{ id: string }>('SELECT id FROM workspaces LIMIT 1'))[0]!.id,
      ]);
      const { rows } = await client.query('SELECT count(*)::int AS n FROM contacts');
      expect(rows[0].n).toBe(4);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  }, 180000);

  it('po obnově platí i append-only omezení z mlain_apply_grants()', async () => {
    // Append-only REVOKE jsou uvnitř téže funkce (P03, R25). Kdyby obnova
    // volala jen granty a ne funkci, byly by tabulky auditu po havárii
    // najednou zapisovatelné a nikdo by si toho nevšiml.
    const client = await freshAppClient();
    try {
      await expect(client.query('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  }, 180000);
});
