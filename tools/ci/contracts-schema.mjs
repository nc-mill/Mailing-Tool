#!/usr/bin/env node
// Job contracts-schema. Proti Postgresu ze services: aplikuje migrace a ověří,
// že kontraktní sloupce existují a mají očekávaný typ (část 1, kapitola 3.15).
//
// Tenhle čtvrtý bod test:parity NEBĚŽÍ v contracts-golden, protože ten databázi
// nemá a mít nemá. Bez toho rozdělení by buď spadl na chybějícím připojení,
// nebo, hůř, byl potichu přeskočen jako "nedostupná databáze".
//
// Manifest kontraktních sloupců se NEČTE tady. Dřívější znění hledalo
// packages/contracts/schema/columns.json, jenže P02 ten soubor pojmenoval
// fixtures/outbox/contract-columns.json a dal mu jiný tvar (mapa `messages`
// plus mapa `foreign` na pole jmen bez typů). Job by tedy tiše skipoval
// napořád a plochý `Object.entries` nad polem by z indexů udělal jména sloupců.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const MIGRATIONS = path.resolve(process.cwd(), 'packages/db/migrations');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, kontraktní sloupce dodá plán P02');
}
// Prázdný adresář zakládá P01 kvůli Dockerfilu, takže se kontroluje obsah,
// ne jen existence.
if (!fs.existsSync(MIGRATIONS) || fs.readdirSync(MIGRATIONS).every((f) => f.startsWith('.'))) {
  skip('packages/db/migrations je zatím prázdný, migrace dodá plán P03');
}
if (!process.env.DATABASE_URL_MIGRATOR) {
  fail([
    'contracts-schema potřebuje DATABASE_URL_MIGRATOR proti Postgresu ze services:.',
    'Nedostupná databáze se NIKDY nepřeskakuje: bez ní by kontraktní sloupce nehlídalo nic.',
  ]);
}

delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:schema',
  owner: 'P02',
  purpose: 'scénáře outboxu a kontrola kontraktních sloupců proti databázi',
});

ok('všechny kontraktní sloupce existují a mají očekávaný typ');
