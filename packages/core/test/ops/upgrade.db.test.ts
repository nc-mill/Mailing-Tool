import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openConnectionAs, startTestPostgres, type TestPostgres } from '../support/db';
import { ProcessesStillRunningError, runUpgrade } from '../../src/ops/upgrade';

let pg: TestPostgres;
let root: string;

const base = () => ({
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  backupDir: join(root, 'backups'),
  uploadsDir: join(root, 'uploads'),
  dataDir: root,
  appVersion: '1.0.0',
  secretKeyFingerprint: 'VXGoNjoPSBY',
  readinessUrl: 'http://127.0.0.1:1/api/health/ready',
  now: new Date(),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  root = await mkdtemp(join(tmpdir(), 'mlain-upgrade-'));
  await pg.seedMinimalInstallation({ contacts: 2 });
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('runUpgrade', () => {
  it('odmítne běžet, dokud jsou připojené worker nebo sender', async () => {
    const holder = await openConnectionAs(pg, 'mlain-worker');
    try {
      await expect(runUpgrade(base())).rejects.toThrow(ProcessesStillRunningError);
    } finally {
      await holder.close();
    }
  }, 180000);

  it('hláška jmenuje konkrétní příkazy na zastavení', async () => {
    const holder = await openConnectionAs(pg, 'mlain-sender');
    try {
      const err = await runUpgrade(base()).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('docker compose stop');
      expect((err as Error).message).toContain('mlain-sender');
    } finally {
      await holder.close();
    }
  }, 180000);

  it('udělá zálohu dřív, než pustí migrace', async () => {
    const report = await runUpgrade({ ...base(), skipReadiness: true });
    expect(report.backupDir).toContain('mlain-');
    expect(report.steps.indexOf('backup')).toBeLessThan(report.steps.indexOf('migrate'));
  }, 180000);

  it('vypíše přesné příkazy na návrat procesů', async () => {
    const report = await runUpgrade({
      ...base(),
      skipReadiness: true,
      now: new Date(Date.now() + 1000),
    });
    expect(report.nextSteps).toContain('docker compose up -d');
  }, 180000);

  it('nespustí migrace, když záloha selže', async () => {
    await expect(
      runUpgrade({ ...base(), backupDir: '/proc/nelze/zapsat', skipReadiness: true }),
    ).rejects.toThrow();
  }, 180000);
});
