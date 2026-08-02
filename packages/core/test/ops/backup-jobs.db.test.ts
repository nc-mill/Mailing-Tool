import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY } from '../../src/queues/index';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { allowCreateDatabases } from '../support/pg-superuser';
import { backupJob, backupVerifyJob } from '../../src/ops/jobs/backup-jobs';

let pg: TestPostgres;
let root: string;

const jobCtx = () => ({
  config: {
    DATABASE_URL: pg.ownerUrl,
    DATABASE_URL_MIGRATOR: pg.ownerUrl,
    BACKUP_DIR: join(root, 'backups'),
    UPLOADS_DIR: join(root, 'uploads'),
    DATA_DIR: root,
    BACKUP_RETENTION_DAYS: 14,
    IMAGE_VERSION: '1.0.0',
    SECRET_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    SECRET_KEY_PREVIOUS: '',
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
  await allowCreateDatabases(pg.ownerUrl);
  root = await mkdtemp(join(tmpdir(), 'mlain-jobs-'));
  await pg.seedMinimalInstallation({ contacts: 5 });
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('registr front', () => {
  // ODCHYLKA OD PLÁNU: registr se jmenuje QUEUE_REGISTRY, ne QUEUES.
  it('obě fronty jsou předdeklarované a patří P16', () => {
    const backup = QUEUE_REGISTRY.find((q) => q.name === 'platform.backup');
    const verify = QUEUE_REGISTRY.find((q) => q.name === 'platform.backup_verify');
    expect(backup?.owner).toBe('P16');
    expect(verify?.owner).toBe('P16');
    expect(backup?.cron).toBe('0 3 * * *');
  });
});

describe('backupJob', () => {
  it('vytvoří zálohu a zapíše do auditu', async () => {
    await backupJob(jobCtx());
    const entries = await readdir(join(root, 'backups'));
    expect(entries.some((e) => e.startsWith('mlain-'))).toBe(true);
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.created'",
    );
    expect(rows.length).toBe(1);
  }, 120_000);
});

describe('backupVerifyJob', () => {
  it('ověří poslední zálohu a zapíše výsledek do auditu', async () => {
    const report = await backupVerifyJob(jobCtx());
    expect(report.ok).toBe(true);
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.verified'",
    );
    expect(rows.length).toBe(1);
  }, 180_000);

  it('bez jediné zálohy skončí bez pádu a nahlásí to', async () => {
    const empty = { config: { ...jobCtx().config, BACKUP_DIR: join(root, 'nic') } };
    const report = await backupVerifyJob(empty);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/žádná záloha/i);
  }, 60_000);
});
