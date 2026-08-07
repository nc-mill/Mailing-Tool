#!/usr/bin/env node
// Job openapi-drift. Soubor packages/contracts/openapi.json je commitnutý
// a musí se bajt po bajtu shodovat s vygenerovaným (část 1, kapitola 4.7).
//
// PRAVIDLO (uzávěr S9): openapi.json se NIKDY neslučuje ručně. Při konfliktu
// v gitu se zahodí obě verze a přegeneruje se.
//
// BRÁNA SI DOKUMENT VYRÁBÍ SAMA (nález I95). Dřívější znění jen porovnávalo
// dva soubory na disku a nic negenerovalo. Když po změně tras nikdo generátor
// nepustil, byly zastaralé oba, byly si navzájem rovné a brána hlásila OK.
// Chytila tedy jedinou situaci: někdo generoval a zapomněl výsledek zkopírovat.
// Zuby měl naproti tomu apps/web/test/api/openapi.test.ts, protože porovnává
// ŽIVĚ SLOUŽENÝ dokument proti commitnutému souboru. Tenhle job teď měří totéž:
// spustí generátor a teprve jeho čerstvý výstup porovná s commitnutým souborem.
//
// Spoléhat na to, že generátor pustí krok ve workflow PŘED tímhle jobem, nešlo:
// `pnpm contracts:generate` je turbo úloha, takže při zásahu cache se nespustí
// vůbec a job by zase porovnával dva zastaralé soubory. Proto se volá skript
// vlastníka přímo, bez turba.
//
// SOUVISEJÍCÍ ZMĚNA V turbo.json: úloha `contracts:generate` má nově
// `cache: false` a prázdné `outputs`. Dřív měla `cache: true` a v `outputs`
// ["packages/contracts/fixtures/**", "packages/contracts/openapi.json"], jenže
// turbo bere `outputs` RELATIVNĚ k adresáři balíčku a apps/web zapisuje mimo
// sebe, do packages/contracts/openapi.generated.json. Ty cesty tedy ukazovaly
// na apps/web/packages/contracts/..., kde nikdy nic nevzniklo. Cache ukládala
// prázdno a při zásahu generátor NEPROBĚHL. Kdo tam cache vrátí, vrátí i tenhle
// nález. (Vysvětlení je tady, ne v turbo.json: ten musí zůstat striktní JSON,
// protože apps/web/test/ci/e2e-wiring.test.ts ho parsuje JSON.parse.)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const WEB = path.resolve(process.cwd(), 'apps/web');
const committed = path.join(CONTRACTS, 'openapi.json');
const generated = path.join(CONTRACTS, 'openapi.generated.json');

if (!fs.existsSync(committed)) {
  skip('packages/contracts/openapi.json zatím neexistuje, generátor dodá plán P04');
}

// Generátor vlastní apps/web, protože dokument se skládá z definic tras.
// Polarita je stejná jako u delegate(): chybí-li skript vlastníka, je to FAIL,
// nikdy tiché přeskočení. Brána bez generátoru nekontroluje nic.
const webManifest = path.join(WEB, 'package.json');
if (!fs.existsSync(webManifest)) {
  fail([
    'packages/contracts/openapi.json existuje, ale apps/web/package.json ne.',
    'Bez generátoru nemá brána co porovnávat a porovnání dvou souborů na disku',
    'nedokazuje nic: zastaralé mohou být oba.',
    'Dodává ho plán P04: pnpm --filter @mlain/web run contracts:generate',
  ]);
}
const webScripts = JSON.parse(fs.readFileSync(webManifest, 'utf8')).scripts ?? {};
if (!webScripts['contracts:generate']) {
  fail([
    'apps/web existuje, ale skript "contracts:generate" v jeho package.json chybí.',
    'Dodává ho plán P04: zapisuje packages/contracts/openapi.generated.json.',
    'Chybějící generátor se NIKDY neobchází porovnáním dvou souborů na disku,',
    'protože zastaralé mohou být oba a brána by hlásila zelenou o ničem.',
  ]);
}

/*
 * NEJDŘÍV SE SESTAVÍ ZÁVISLOSTI, teprve pak se generuje.
 *
 * Generátor běží NAPŘÍMO, ne přes turbo (důvod je o kus výš: zásah cache dělal
 * z brány zelenou o ničem). Tím ale obchází i graf závislostí, který by jinak
 * potřebné balíčky sestavil sám. `@mlain/contracts` a `@mlain/db` vydávají svoje
 * rozhraní z `dist`, takže na ČISTÉM checkoutu ten adresář neexistuje a import
 * skončí na `ERR_MODULE_NOT_FOUND: @mlain/contracts/dist/crypto.js`.
 *
 * Na vývojářském stroji se to neprojeví: `dist` tam leží po dřívějším buildu.
 * Právě proto to týden nikdo neviděl, běh CI totiž umíral dřív, na verzi pnpm.
 *
 * `^...` je zápis pnpm pro ZÁVISLOSTI balíčku bez něj samotného, takže se
 * nesestavuje `apps/web` a graf rozhoduje o pořadí, ne tenhle seznam.
 */
try {
  execFileSync('pnpm', ['--filter', '@mlain/web^...', 'run', 'build'], { stdio: 'inherit' });
} catch {
  fail([
    'Sestavení závislostí apps/web selhalo: pnpm --filter @mlain/web^... run build',
    'Bez `dist` u @mlain/contracts a @mlain/db se generátor nespustí.',
  ]);
}

// Čas začátku slouží k důkazu, že soubor opravdu vznikl teď. Sekundu zpět kvůli
// souborovým systémům se sekundovým rozlišením mtime.
const startedAt = Date.now() - 1000;
try {
  execFileSync('pnpm', ['--filter', '@mlain/web', 'run', 'contracts:generate'], {
    stdio: 'inherit',
  });
} catch {
  fail([
    'Generátor OpenAPI selhal: pnpm --filter @mlain/web run contracts:generate',
    'Dokud neprojde, není proti čemu commitnutý openapi.json porovnat.',
  ]);
}

if (!fs.existsSync(generated)) {
  fail([
    'Generátor doběhl, ale openapi.generated.json nevznikl.',
    'Krok, který má něco VYROBIT, se nikdy neověřuje jen návratovým kódem.',
  ]);
}
if (fs.statSync(generated).mtimeMs < startedAt) {
  fail([
    'openapi.generated.json je starší než běh generátoru, tedy z dřívějška.',
    'Porovnání proti zastaralému souboru nedokazuje nic. Zkontroluj, kam',
    'apps/web/scripts/generate-openapi.ts s přepínačem --generated zapisuje.',
  ]);
}

if (fs.readFileSync(committed, 'utf8') !== fs.readFileSync(generated, 'utf8')) {
  fail([
    'Commitnutý openapi.json se liší od právě vygenerovaného dokumentu.',
    'Nikdy ho neslučuj ručně. Spusť: pnpm --filter @mlain/web run generate:openapi',
    'a commitni výsledek.',
  ]);
}
ok('openapi.json je shodný s právě vygenerovaným dokumentem');
