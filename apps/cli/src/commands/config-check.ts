import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes';
import type { CliStreams } from '../dispatch';

/**
 * Volá ho entrypoint jako první krok. Při chybě vypíše VŠECHNY problémy naráz
 * a vrátí 78 (akceptační kritéria 2 a 3).
 */
export function runConfigCheck(
  streams: CliStreams,
  env: Record<string, string | undefined>,
): number {
  try {
    const config = loadConfig(env);
    streams.stdout(`Konfigurace je v pořádku. MODE=${config.MODE}, verze ${config.IMAGE_VERSION}.`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.stderr(error.format());
      return EXIT_CONFIG;
    }
    throw error;
  }
}
