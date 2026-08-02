import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COMPOSE_ENV, REPO_ROOT } from './fixtures/test-data';

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

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`${url} neodpovědělo do ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Zlatá cesta musí projít na ČISTÉ instalaci, jinak netestuje instalaci,
 * ale zbytky po minulém běhu. Proto `down --volumes` před každým během.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  await run('docker', [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans'], {
    cwd: REPO_ROOT,
    env: COMPOSE_ENV,
  });
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
