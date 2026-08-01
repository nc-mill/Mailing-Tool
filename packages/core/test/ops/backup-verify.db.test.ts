import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { allowCreateDatabases } from '../support/pg-superuser';
import { runBackup } from '../../src/ops/backup';
import { readManifest, writeManifest } from '../../src/ops/backup-manifest';
import { verifyBackup } from '../../src/ops/backup-verify';

let pg: TestPostgres;
let backupDir: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  await allowCreateDatabases(pg.ownerUrl);
  const root = await mkdtemp(join(tmpdir(), 'mlain-verify-'));
  await pg.seedMinimalInstallation({ contacts: 11 });
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

const verifyDbs = async () =>
  pg.sql<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname LIKE 'ml_verify_%'`);

describe('verifyBackup', () => {
  it('na čerstvé záloze skončí v pořádku (kritérium 10)', async () => {
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('nenechá po sobě databázi ml_verify_* (kritérium 10)', async () => {
    await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(await verifyDbs()).toEqual([]);
  });

  it('pozná rozdíl v počtu řádků a pojmenuje tabulku', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      row_counts: { ...manifest.row_counts, contacts: 999 },
    });
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('contacts');
    await writeManifest(backupDir, manifest);
  });

  it('pozná poškozený dump podle kontrolního součtu, aniž zakládá databázi', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      database: { ...manifest.database, sha256: 'f'.repeat(64) },
    });
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/kontroln|sha256/i);
    expect(await verifyDbs()).toEqual([]);
    await writeManifest(backupDir, manifest);
  });

  it('uklidí dočasnou databázi i tehdy, když obnova spadne', async () => {
    await expect(
      verifyBackup({ backupDir: join(backupDir, 'neexistuje'), adminUrl: pg.ownerUrl }),
    ).rejects.toThrow();
    expect(await verifyDbs()).toEqual([]);
  });
});
