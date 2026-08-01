#!/usr/bin/env node
// Job openapi-drift. Soubor packages/contracts/openapi.json je commitnutý
// a musí se bajt po bajtu shodovat s vygenerovaným (část 1, kapitola 4.7).
//
// PRAVIDLO (uzávěr S9): openapi.json se NIKDY neslučuje ručně. Při konfliktu
// v gitu se zahodí obě verze a přegeneruje se.
import fs from 'node:fs';
import path from 'node:path';
import { fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const committed = path.join(CONTRACTS, 'openapi.json');
const generated = path.join(CONTRACTS, 'openapi.generated.json');

if (!fs.existsSync(committed)) {
  skip('packages/contracts/openapi.json zatím neexistuje, generátor dodá plán P04');
}
if (!fs.existsSync(generated)) {
  fail([
    'openapi.json existuje, ale openapi.generated.json chybí.',
    'Spusť: pnpm contracts:generate',
  ]);
}

if (fs.readFileSync(committed, 'utf8') !== fs.readFileSync(generated, 'utf8')) {
  fail([
    'Commitnutý openapi.json se liší od vygenerovaného.',
    'Nikdy ho neslučuj ručně. Spusť: pnpm contracts:generate a commitni výsledek.',
  ]);
}
ok('openapi.json je shodný s vygenerovaným');
