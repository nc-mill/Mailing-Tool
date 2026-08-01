import { loadConfig, type MlainConfig } from '@mlain/core/config';
import { createLogger, type Logger } from '@mlain/core/logging';

import journal from '../../../../packages/db/migrations/meta/_journal.json';

/**
 * Nejvyšší číslo migrace zabudované v tomhle buildu.
 *
 * ODCHYLKA OD PŮVODNÍHO ZNĚNÍ: dřívější verze čtení dělala za běhu přes
 * `fs.readFileSync` a cestu počítala z `import.meta.dirname`. V produkčním
 * standalone bundlu Next.js/Turbopack ale `import.meta.dirname` nedoplňuje
 * (je `undefined`), takže výpočet cesty spadl na `ERR_INVALID_ARG_TYPE` a
 * `next build` končil na "Failed to collect page data for /api/health".
 * I po opravě (výpočet cesty uvnitř try) by hodnota v bundlu byla natrvalo 0,
 * protože relativní cesta ze zdrojového stromu v běžícím standalone výstupu
 * neexistuje ve stejné adresářové hloubce.
 *
 * Řešení: statický import JSON modulu. Bundler (Next/Turbopack i Vite ve
 * vitestu) ho vyhodnotí a zapeče v BUILD čase, kdy zdrojový strom se
 * `packages/db/migrations/meta/_journal.json` skutečně existuje na tomhle
 * relativním místě; běhový proces už žádnou cestu nepočítá.
 *
 * Zdrojem pravdy zůstává tentýž soubor, ze kterého počítá číslo migrační
 * runner v P03: `entries.length`. Dokud journal neexistuje, `resolveJsonModule`
 * / bundler import selže při БUILDu, ne za běhu; to je ale bezpečné, protože
 * P01 v tomhle bodě staví s prázdným `entries: []` (viz `packages/db/migrations/
 * .gitkeep` založené P01 v úkolu 5) a `entries.length` je pak 0, tedy `skip`
 * podle rozhodnutí D3. Jakmile P03 první migraci commitne, hodnota se zvýší
 * automaticky při dalším buildu a kontrola se sama stane ostrou.
 */
function readExpectedSchemaVersion(): number {
  return Array.isArray(journal.entries) ? journal.entries.length : 0;
}

export const EXPECTED_SCHEMA_VERSION = readExpectedSchemaVersion();

let config: MlainConfig | undefined;
let logger: Logger | undefined;

export function getConfig(): MlainConfig {
  config ??= loadConfig();
  return config;
}

export function getLogger(): Logger {
  if (!logger) {
    const current = getConfig();
    logger = createLogger({
      level: current.LOG_LEVEL,
      format: current.LOG_FORMAT,
      mode: 'web',
      version: current.IMAGE_VERSION,
    });
  }
  return logger;
}
