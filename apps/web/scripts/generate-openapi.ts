import { writeFileSync } from 'node:fs';
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
