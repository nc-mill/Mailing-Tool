import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

const run = promisify(execFile);

const COMPOSE_ARGS = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
];

/**
 * Log kontejneru se ukládá vždycky, i po zeleném běhu. Bez něj se pád zlaté
 * cesty v CI vyšetřuje z toho, co je vidět v prohlížeči, a příčina bývá
 * v logu aplikace.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  const logs = await run('docker', [...COMPOSE_ARGS, 'logs', '--no-color'], {
    cwd: process.cwd(),
    maxBuffer: 64e6,
  }).catch((err: Error) => ({ stdout: `logy se nepodařilo přečíst: ${err.message}` }));

  await mkdir('playwright-report-golden', { recursive: true });
  await writeFile('playwright-report-golden/compose-logs.txt', logs.stdout, 'utf8');

  await run('docker', [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans'], {
    cwd: process.cwd(),
  });
}
