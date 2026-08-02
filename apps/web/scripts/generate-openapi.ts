import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildApp, buildOpenApiDocument } from '../src/lib/api/openapi';

/**
 * Uzávěr S9 řídicího dokumentu: openapi.json se NIKDY neslučuje ručně.
 * Při konfliktu se obě verze zahodí a soubor se přegeneruje tímhle skriptem.
 *
 * ODCHYLKA OD PLÁNU: skript umí zapsat do dvou cílů.
 *
 * Plán počítal jen s commitnutým `openapi.json`. Job `openapi-drift`
 * (`tools/ci/openapi-drift.mjs`, vlastní P01) ale porovnává commitnutý soubor
 * s `openapi.generated.json`, který si v CI vyrábí `pnpm contracts:generate`.
 * Kdyby ho nikdo negeneroval, job by od chvíle, kdy `openapi.json` vznikne,
 * padal na „openapi.generated.json chybí". Bez přepínače by zas obě verze
 * vznikaly z jednoho běhu a porovnání by nemohlo odchylku najít nikdy.
 *
 *   pnpm --filter @mlain/web generate:openapi     zapíše openapi.json
 *   pnpm --filter @mlain/web contracts:generate   zapíše openapi.generated.json
 */
/**
 * Generátor nepotřebuje SKUTEČNOU konfiguraci, ale nesmí bez ní spadnout.
 *
 * `buildApp()` volá `createApiApp()` a ten sáhne na `getConfig()`, takže
 * bez prostředí skončí skript na `ConfigError: Konfigurace není platná`
 * a nikdo nepřegeneruje dokument. V CI ani na čerstvém checkoutu žádné
 * `.env.local` není, takže by to selhalo právě tam, kde je to nejvíc potřeba.
 *
 * Doplňují se JEN chybějící hodnoty, takže skutečné prostředí má přednost.
 * Jsou to zjevné atrapy: do dokumentu se nedostanou, slouží jen k tomu, aby
 * validace prostředí prošla. `SECRET_KEY` je náhodný, aby se nikoho nesvádělo
 * ho odněkud opsat.
 */
function ensureConfigForGeneration(): void {
  const dummies: Record<string, string> = {
    APP_URL: 'http://localhost:3000',
    SECRET_KEY: `1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`,
    DATABASE_URL: 'postgresql://mlain_app:mlain@127.0.0.1:5432/mlain',
    // `DATA_DIR` musí být adresář, který SKUTEČNĚ existuje a jde do něj zapsat,
    // protože to validace prostředí ověřuje voláním na disk. Výchozí `/data`
    // je cesta uvnitř kontejneru a na stroji vývojáře ani v CI neexistuje.
    DATA_DIR: tmpdir(),
    // Bez tohohle validace trvá na migrátorovi, protože `MIGRATE_ON_START`
    // je ve výchozím stavu zapnuté. Generátor nemigruje, jen čte definice cest.
    MIGRATE_ON_START: 'false',
  };
  for (const [key, value] of Object.entries(dummies)) {
    process.env[key] ??= value;
  }
}

ensureConfigForGeneration();

const generated = process.argv.includes('--generated');
const fileName = generated ? 'openapi.generated.json' : 'openapi.json';
const target = fileURLToPath(new URL(`../../../packages/contracts/${fileName}`, import.meta.url));

const document = buildOpenApiDocument(buildApp());
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
// `process.stdout.write`, ne `console.log`: lint povoluje z konzole jen `error`
// a hlášení generátoru patří na standardní výstup, ne mezi chyby.
process.stdout.write(
  `${fileName} zapsán, cest: ${Object.keys(document.paths ?? {}).length}, operací: ${Object.values(
    document.paths ?? {},
  ).reduce((sum, methods) => sum + Object.keys(methods).length, 0)}\n`,
);
