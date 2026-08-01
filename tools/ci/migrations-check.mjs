#!/usr/bin/env node
// Job migrations-check. Tři scénáře z části 1, kapitoly 3.13:
//   1. Prázdná databáze + všechny migrace = schéma odpovídá snapshotu, žádný drift.
//   2. Databáze z tagu předchozího vydání + nové migrace = projde bez chyby.
//   3. Seed s 10 000 řádky na klíčových tabulkách, aby NOT NULL a UNIQUE
//      narazily na reálná data.
//
// Scénáře NEJSOU tady a být tady nemají: potřebují Drizzle, migrace
// a testcontainers, což do samostatného .mjs skriptu nepatří. P03 je píše do
// packages/db/test/migrations-check.test.ts a spouští skriptem test:migrations.
//
// Dřívější znění místo toho na konci bezpodmínečně volalo fail() a předávalo
// P03 požadavek, ať scénáře doplní PŘÍMO SEM. To předání nemohlo dosednout:
// tools/ci/** je výhradní vlastnictví P01 a P03 má vlastní pravidlo, že do
// cizích adresářů nesahá. Job by tedy po mergnutí P03 zůstal červený navždy
// a protože je blokující, neprošel by od té chvíle žádný pull request.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const RUNNER = path.resolve(process.cwd(), 'packages/db/src/migrate.ts');

if (!fs.existsSync(RUNNER)) {
  skip('packages/db/src/migrate.ts zatím neexistuje, migrační runner dodá plán P03');
}
if (!process.env.DATABASE_URL_MIGRATOR) {
  fail([
    'migrations-check potřebuje DATABASE_URL_MIGRATOR proti Postgresu ze services:.',
    'Chybějící databáze se nikdy nepřeskakuje.',
  ]);
}

delegate({
  packageName: '@mlain/db',
  directory: 'packages/db',
  script: 'test:migrations',
  owner: 'P03',
  purpose: 'tři scénáře migrací z části 1, kapitoly 3.13',
});

ok('tři scénáře migrací prošly');
