import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COMPOSE_ENV, REPO_ROOT } from './test-data';

const run = promisify(execFile);

const COMPOSE_ARGS = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
  '--profile',
  'bundled',
];

/**
 * Čistá instalace pro scénář, který zakládá účet.
 *
 * PROČ TO EXISTUJE. Global setup staví instalaci JEDNOU za celý běh, ale
 * `createAdminAndProject()` volá šest z šestnácti testů. Registrace je přitom
 * otevřená jen dokud instalace nemá prvního uživatele, takže setupem projde
 * jedině ten scénář, který běží první v abecedě. Ostatní dostanou 409.
 * Naměřeno v logu instalace při běhu celé sady:
 *
 *   POST /api/v1/setup: 1× 201, 4× 409
 *
 * a každá z těch čtyř čtyřistadevítek stála šest minut, protože scénář čekal
 * na přesměrování, které nemohlo přijít. Osm z deseti pádů celé sady mělo
 * tuhle jedinou příčinu.
 *
 * PROČ RESET, A NE PŘIHLÁŠENÍ POD EXISTUJÍCÍM ÚČTEM. Zvažovaly se obě cesty.
 * Přihlášení je rychlejší, ale nedá čistý stav: scénáře by si předávaly
 * kontakty, kampaně a zálohy po sobě a `backup-restore` počítá kontakty
 * v záloze, takže by měřil cizí data. Reset naopak čistý stav dá a stojí
 * míň, než se čekalo: nastartování měřeno na 14 s, celý cyklus i s migracemi
 * kolem 30 s. Šest resetů je tedy pod třemi minutami, zatímco šestnáct
 * šestiminutových čekání na vypršení limitu bylo 26,7 minuty.
 */
export async function freshInstallation(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  await run(
    'docker',
    [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans', '--timeout', '10'],
    {
      cwd: REPO_ROOT,
      env: COMPOSE_ENV,
    },
  );
  await run('docker', [...COMPOSE_ARGS, 'up', '-d'], {
    cwd: REPO_ROOT,
    maxBuffer: 32e6,
    env: COMPOSE_ENV,
  });

  const base = process.env.MLAIN_E2E_BASE_URL ?? 'http://localhost:3000';
  await waitForReady(`${base}/api/health/ready`, 120_000);
  await waitForReady(
    `${process.env.MLAIN_E2E_MAILPIT_URL ?? 'http://localhost:8025'}/readyz`,
    60_000,
  );
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`${url} neodpovědělo do ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
