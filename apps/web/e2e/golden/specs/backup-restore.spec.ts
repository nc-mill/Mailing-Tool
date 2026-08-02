import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { COMPOSE_ENV, REPO_ROOT } from '../fixtures/test-data';
import { SetupPage } from '../pages/setup.page';
import { OnboardingPage } from '../pages/onboarding.page';

const run = promisify(execFile);

const COMPOSE = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
];

async function mlain(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await run('docker', [...COMPOSE, 'exec', '-T', 'app', 'mlain', ...args], {
      maxBuffer: 32e6,
      env: COMPOSE_ENV,
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** První sloupec prvního řádku výpisu `mlain backup list`. */
function firstBackupName(stdout: string): string {
  const name = stdout.trim().split('\n')[0]?.split('\t')[0];
  if (name === undefined || name === '')
    throw new Error('mlain backup list nevrátil žádnou zálohu.');
  return name;
}

test.describe('zálohy proti běžící instalaci', () => {
  test.slow();

  test('kritéria 9 a 10: záloha má tři soubory, sedící počet a projde ověřením', async ({
    page,
  }) => {
    const setup = new SetupPage(page);
    await setup.open();
    const slug = await setup.createAdminAndProject();
    await new OnboardingPage(page, slug).openDashboard();
    await page.request.post('/api/v1/demo-data');

    const backup = await mlain(['backup']);
    expect(backup.code).toBe(0);
    expect(backup.stdout).toMatch(/Kontaktů v záloze: 50/);
    expect(backup.stdout).toMatch(/keyring/i);

    const dir = backup.stdout.match(/Záloha hotová: (\S+)/)?.[1];
    expect(dir).toBeTruthy();

    const listing = await run('docker', [...COMPOSE, 'exec', '-T', 'app', 'ls', dir!], {
      env: COMPOSE_ENV,
      cwd: REPO_ROOT,
    });
    expect(listing.stdout).toContain('database.dump');
    expect(listing.stdout).toContain('uploads.tar.gz');
    expect(listing.stdout).toContain('manifest.json');

    const verify = await mlain(['backup', 'verify', dir!]);
    expect(verify.code).toBe(0);

    const leftovers = await run(
      'docker',
      [
        ...COMPOSE,
        'exec',
        '-T',
        'postgres',
        'psql',
        // Superuživatel téhle instalace se jmenuje `mlain_migrator`, ne
        // `postgres`. Základní compose má `POSTGRES_USER: mlain_migrator`,
        // takže role `postgres` v databázi VŮBEC NEEXISTUJE. Plán tu má
        // `-U postgres` a běh na to spadl doslova takhle:
        //   psql: error: ... FATAL: role "postgres" does not exist
        '-U',
        'mlain_migrator',
        '-tAc',
        "SELECT count(*) FROM pg_database WHERE datname LIKE 'ml_verify_%'",
      ],
      { env: COMPOSE_ENV, cwd: REPO_ROOT },
    );
    expect(leftovers.stdout.trim()).toBe('0');
  });

  test('kritérium 11: obnova do neprázdné databáze bez --force selže a nic nezmění', async () => {
    const list = await mlain(['backup', 'list']);
    const name = firstBackupName(list.stdout);

    const before = await mlain(['doctor', '--json']);
    const restore = await mlain(['restore', `/data/backups/${name}`]);
    expect(restore.code).not.toBe(0);
    expect(restore.stderr).toMatch(/není prázdná/);
    expect(restore.stderr).toMatch(/Nic jsem nezměnil/);

    const after = await mlain(['doctor', '--json']);
    expect(after.stdout).toBe(before.stdout);
  });

  test('kritérium 12: záloha z novější verze je odmítnutá', async () => {
    const list = await mlain(['backup', 'list']);
    const name = firstBackupName(list.stdout);
    await run(
      'docker',
      [
        ...COMPOSE,
        'exec',
        '-T',
        'app',
        'sh',
        '-c',
        `sed -i 's/"app_version": "[^"]*"/"app_version": "999.0.0"/' /data/backups/${name}/manifest.json`,
      ],
      { env: COMPOSE_ENV, cwd: REPO_ROOT },
    );
    const restore = await mlain(['restore', `/data/backups/${name}`, '--force']);
    expect(restore.code).not.toBe(0);
    expect(restore.stderr).toContain('backup_from_newer_version');
  });

  test('mlain doctor na zdravé instalaci nehlásí kritický nález', async () => {
    const doctor = await mlain(['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).not.toContain('[KRITICKÉ]');
  });

  test('mlain doctor bez starého pokolení klíče hlásí kritickou chybu', async () => {
    // Simulace ztráty starého klíče: suppression řádek pod pokolením 7,
    // které instalace nezná.
    await run(
      'docker',
      [
        ...COMPOSE,
        'exec',
        '-T',
        'postgres',
        'psql',
        // Superuživatel téhle instalace se jmenuje `mlain_migrator`, ne
        // `postgres`. Základní compose má `POSTGRES_USER: mlain_migrator`,
        // takže role `postgres` v databázi VŮBEC NEEXISTUJE. Plán tu má
        // `-U postgres` a běh na to spadl doslova takhle:
        //   psql: error: ... FATAL: role "postgres" does not exist
        '-U',
        'mlain_migrator',
        '-d',
        'mlain',
        '-c',
        `INSERT INTO suppressions (workspace_id, email, reason, source, fingerprint, fingerprint_key_id)
       SELECT id, 'ztraceny@example.com', 'hard_bounce', 'ses_event',
              decode(repeat('ab', 16), 'hex'), 7 FROM workspaces LIMIT 1`,
      ],
      { env: COMPOSE_ENV, cwd: REPO_ROOT },
    );
    const doctor = await mlain(['doctor']);
    expect(doctor.code).toBe(2);
    expect(doctor.stdout).toContain('missing_key_generations');
    expect(doctor.stdout).toContain('[KRITICKÉ]');
    expect(doctor.stdout).toMatch(/nejdou přepočítat/);
  });
});
