import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes';
import type { CliStreams } from '../dispatch';

interface Probe {
  readonly label: string;
  readonly url: string;
}

/**
 * Co volá `mlain healthcheck` podle MODE (část 1, kapitola 3.12):
 *   web    -> GET localhost:${PORT}/api/health/ready
 *   worker -> GET localhost:${WORKER_HEALTH_PORT}/readyz
 *   sender -> GET localhost:${SENDER_HEALTH_PORT}/readyz
 *   all    -> všechny tři; spadne, když spadne kterýkoliv
 */
function probesFor(config: {
  MODE: string;
  PORT: number;
  WORKER_HEALTH_PORT: number;
  SENDER_HEALTH_PORT: number;
}): Probe[] {
  const web: Probe = { label: 'web', url: `http://127.0.0.1:${config.PORT}/api/health/ready` };
  const worker: Probe = {
    label: 'worker',
    url: `http://127.0.0.1:${config.WORKER_HEALTH_PORT}/readyz`,
  };
  const sender: Probe = {
    label: 'sender',
    url: `http://127.0.0.1:${config.SENDER_HEALTH_PORT}/readyz`,
  };
  switch (config.MODE) {
    case 'web':
      return [web];
    case 'worker':
      return [worker];
    case 'sender':
      return [sender];
    default:
      return [web, worker, sender];
  }
}

export async function runHealthcheck(
  streams: CliStreams,
  env: Record<string, string | undefined>,
): Promise<number> {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.stderr(error.format());
      return EXIT_CONFIG;
    }
    throw error;
  }

  let failed = false;
  for (const probe of probesFor(config)) {
    try {
      const response = await fetch(probe.url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        failed = true;
        streams.stderr(`${probe.label}: HTTP ${response.status} na ${probe.url}`);
      } else {
        streams.stdout(`${probe.label}: ok`);
      }
    } catch (error) {
      failed = true;
      streams.stderr(`${probe.label}: ${(error as Error).message}`);
    }
  }
  return failed ? 1 : EXIT_OK;
}
