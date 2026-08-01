#!/usr/bin/env node
// Job contracts-fixtures-schema. Validace všech fixtures proti JSON schématům
// v packages/contracts/schema/ (část 1, kapitola 3.15).
//
// Skládat jméno schématu jako `<první segment cesty>.schema.json` NEFUNGUJE:
// P02 pojmenoval schémata `liquid-fixture.schema.json`, `marker-fixture...`,
// `token-vectors...` a tak dál, takže by se netrefilo ANI JEDNO a job by
// po dokončení P02 tvrdě spadl na pěti vymyšlených chybách. Mapu skupina na
// schéma vlastní P02 spolu se schématy, tenhle job jen spouští jeho validátor.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, schémata a fixtures dodá plán P02');
}

delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:fixtures-schema',
  owner: 'P02',
  purpose: 'validace fixtures proti JSON schématům',
});

ok('všechny fixtures odpovídají svým schématům');
