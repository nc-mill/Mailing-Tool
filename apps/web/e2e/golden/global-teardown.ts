import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { COMPOSE_ENV, REPO_ROOT } from './fixtures/test-data';

const run = promisify(execFile);

/**
 * `--profile bundled` musí být i tady, ne jen v global setupu.
 *
 * DOPLNĚK NAD PLÁN, vynucený spuštěním. Služba `postgres` je v základním
 * compose za profilem `bundled`. Bez toho přepínače ji `down` NEZASTAVÍ:
 * kontejner `mlain-e2e-postgres-1` po běhu zůstane běžet, další běh se na něj
 * napojí a tvrzení „zlatá cesta jede na čisté instalaci" přestane platit.
 * Ověřeno spuštěním: po prvním běhu bez profilu zbyl běžící postgres.
 */
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
 * Log kontejneru se ukládá vždycky, i po zeleném běhu. Bez něj se pád zlaté
 * cesty v CI vyšetřuje z toho, co je vidět v prohlížeči, a příčina bývá
 * v logu aplikace.
 *
 * NE do `playwright-report-golden/`, ačkoli tam mířilo dřívější znění. Ten
 * adresář vlastní HTML reporter, který ho při generování reportu vysype, a to
 * se děje AŽ PO teardownu. Log se tedy pokaždé zapsal a vzápětí zmizel:
 * po prvním pádu zlaté cesty v něm zbyly jen `index.html`, `data` a `trace`,
 * takže jediný důkaz o tom, co dělal server, byl pryč. Ověřeno výpisem
 * adresáře po běhu.
 */
const LOG_DIR = 'test-results';
export default async function globalTeardown(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  const logs = await run('docker', [...COMPOSE_ARGS, 'logs', '--no-color'], {
    cwd: REPO_ROOT,
    maxBuffer: 64e6,
    env: COMPOSE_ENV,
  }).catch((err: Error) => ({ stdout: `logy se nepodařilo přečíst: ${err.message}` }));

  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(`${LOG_DIR}/compose-logs.txt`, logs.stdout, 'utf8');

  await run(
    'docker',
    [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans', '--timeout', '10'],
    {
      cwd: REPO_ROOT,
      env: COMPOSE_ENV,
    },
  ).catch(() => undefined);

  await forceRemoveLeftovers();
}

/**
 * Pojistka za `down`.
 *
 * DOPLNĚK NAD PLÁN, vynucený spuštěním. `docker compose down` na kontejneru,
 * který je v restartové smyčce, doběhne, ale kontejner nechá běžet: ověřeno,
 * po `down --volumes` zůstaly všechny tři kontejnery projektu `mlain-e2e`.
 * Na stroji, kde souběžně pracuje víc lidí nebo agentů, se z toho během dne
 * nasbírají desítky kontejnerů a stroj se udusí. Teardown proto po sobě
 * uklidí i tvrdě a stav si ověří, místo aby spoléhal na návratový kód.
 */
async function forceRemoveLeftovers(): Promise<void> {
  const { stdout } = await run(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=mlain-e2e',
      '--format',
      '{{.Names}}',
    ],
    { cwd: REPO_ROOT, env: COMPOSE_ENV },
  ).catch(() => ({ stdout: '' }));

  const names = stdout.split('\n').filter((line) => line.trim() !== '');
  if (names.length > 0) {
    await run('docker', ['rm', '-f', ...names], { cwd: REPO_ROOT, env: COMPOSE_ENV }).catch(
      () => undefined,
    );
  }

  const volumes = await run(
    'docker',
    [
      'volume',
      'ls',
      '--filter',
      'label=com.docker.compose.project=mlain-e2e',
      '--format',
      '{{.Name}}',
    ],
    { cwd: REPO_ROOT, env: COMPOSE_ENV },
  ).catch(() => ({ stdout: '' }));

  const volumeNames = volumes.stdout.split('\n').filter((line) => line.trim() !== '');
  if (volumeNames.length > 0) {
    await run('docker', ['volume', 'rm', '-f', ...volumeNames], {
      cwd: REPO_ROOT,
      env: COMPOSE_ENV,
    }).catch(() => undefined);
  }
}
