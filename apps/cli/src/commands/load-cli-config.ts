import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG } from '../exit-codes';
import type { CliStreams } from '../dispatch';

export type CliConfig = ReturnType<typeof loadConfig>;

/**
 * Načte konfiguraci a vadnou nahlásí tak, jak to dělá `mlain config check`:
 * vypíše VŠECHNY problémy naráz a vrátí 78.
 *
 * Existuje proto, že `loadConfig()` hází `ConfigError`, a kdyby ho příkaz
 * nechal probublat, dostal by provozovatel stacktrace a exit 1 místo seznamu
 * chybějících proměnných. Ověřeno spuštěním: `mlain backup` v prostředí bez
 * konfigurace končil hláškou „ConfigError: Konfigurace není platná,
 * 4 problémů." a stackem přes tři soubory.
 *
 * Vrací `null`, když konfigurace neplatí. Volající pak jen vrátí `EXIT_CONFIG`.
 */
export function loadCliConfig(
  streams: CliStreams,
  env: NodeJS.ProcessEnv,
): { config: CliConfig } | { config: null; code: number } {
  try {
    return { config: loadConfig(env) };
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.stderr(error.format());
      return { config: null, code: EXIT_CONFIG };
    }
    throw error;
  }
}
