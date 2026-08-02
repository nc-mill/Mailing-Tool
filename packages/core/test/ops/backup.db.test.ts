import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { readManifest } from '../../src/ops/backup-manifest';
import { runBackup } from '../../src/ops/backup';

let pg: TestPostgres;
let root: string;

const base = (dir: string) => ({
  databaseUrl: pg.ownerUrl,
  backupDir: join(root, dir),
  uploadsDir: join(root, 'uploads'),
  appVersion: '1.0.0',
  secretKeyFingerprint: 'VXGoNjoPSBY',
  now: new Date(),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  root = await mkdtemp(join(tmpdir(), 'mlain-backup-'));
  await mkdir(join(root, 'uploads'), { recursive: true });
  await writeFile(join(root, 'uploads', 'logo.png'), 'fake-png');
  await pg.seedMinimalInstallation({ contacts: 7 });
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('runBackup', () => {
  it('vytvoří adresář se třemi soubory a jménem podle 3.14 (kritérium 9)', async () => {
    const result = await runBackup({
      ...base('backups'),
      now: new Date('2026-07-31T03:00:00.000Z'),
    });
    expect((await readdir(result.dir)).sort()).toEqual([
      'database.dump',
      'manifest.json',
      'uploads.tar.gz',
    ]);
    expect(result.dir).toContain('mlain-20260731T030000Z');
  }, 120000);

  it('row_counts.contacts odpovídá skutečnosti (kritérium 9)', async () => {
    const result = await runBackup(base('backups2'));
    expect((await readManifest(result.dir)).row_counts['contacts']).toBe(7);
  }, 120000);

  it('manifest nese kontrolní součty obou archivů', async () => {
    const manifest = await readManifest((await runBackup(base('backups3'))).dir);
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.uploads?.files).toBe(1);
  }, 120000);

  it('bez adresáře uploads nechá uploads v manifestu null a nespadne', async () => {
    const result = await runBackup({ ...base('backups4'), uploadsDir: join(root, 'neexistuje') });
    expect((await readManifest(result.dir)).uploads).toBeNull();
  }, 120000);

  it('nedokončenou zálohu nenechá pod finálním jménem', async () => {
    await expect(
      runBackup({ ...base('backups5'), databaseUrl: 'postgres://nikdo:nic@127.0.0.1:1/nic' }),
    ).rejects.toThrow();
    const files = await readdir(join(root, 'backups5')).catch(() => [] as string[]);
    expect(files.filter((f) => !f.endsWith('.partial'))).toEqual([]);
  }, 120000);

  it('zavolá post-backup hook s cestou k adresáři', async () => {
    const hooks = join(root, 'hooks');
    await mkdir(hooks, { recursive: true });
    const hook = join(hooks, 'post-backup.sh');
    await writeFile(hook, '#!/bin/sh\ntouch "$1/hook-was-here.txt"\n');
    await chmod(hook, 0o755);
    const result = await runBackup({ ...base('backups6'), postBackupHook: hook });
    expect(await readdir(result.dir)).toContain('hook-was-here.txt');
  }, 120000);
});
