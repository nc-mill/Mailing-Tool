#!/usr/bin/env node
// Job contracts-golden. Fixtures proti TS i Go implementaci. BEZ DATABÁZE.
//
// Kontrola "kontraktní sloupce existují po migracích" NEBĚŽÍ tady, ale v jobu
// contracts-schema, který Postgres ze services: má (část 1, kapitola 3.15).
//
// TENHLE JOB NEPOROVNÁVÁ JMÉNA SOUBORŮ. Dřívější znění to dělalo a bylo to
// dvojnásob špatně:
//   1) Go fixtures hledalo v apps/sender/testdata/fixtures, jenže `testdata`
//      je SYMLINK na packages/contracts/fixtures, takže podadresář `fixtures`
//      pod ním neexistuje. Množina Go fixtures byla prázdná a job hlásil
//      u KAŽDÉ z 66 fixtur, že je jen na TypeScript straně.
//   2) I po opravě cesty by porovnával adresář sám se sebou přes symlink,
//      tedy by neporovnával nic. Parita dvou implementací se z výpisu adresáře
//      poznat nedá, poznat se dá jen z reportů obou jazyků.
//
// Skutečnou paritu umí jen `test:parity` z P02, který porovnává
// reports/ts-golden.json a reports/go-golden.json. Reporty musí vzniknout
// PŘED ním, proto se v tomhle pořadí spouští všechny tři kroky.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, fixtures a runnery dodá plán P02');
}

// 1) Obě strany musí existovat, než se pustí cokoliv drahého. Kdyby se kontrola
// Go strany dělala až po běhu TypeScript runnerů, chyběl by report jednoho
// jazyka a parita by spadla na nesrozumitelném ENOENT místo na příčině.
const goContracts = path.resolve(process.cwd(), 'apps/sender/internal/contracts');
if (!fs.existsSync(goContracts)) {
  fail([
    'packages/contracts existuje, ale apps/sender/internal/contracts ne.',
    'Bez Go strany není co s čím porovnávat a job by kontroloval jen půlku kontraktu.',
    'Runnery na Go straně dodává plán P02 (rozhodnutí R1).',
  ]);
}

// 2) TypeScript strana vyrobí reports/ts-golden.json.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:golden',
  owner: 'P02',
  purpose: 'runnery golden fixtures nad TypeScript implementací',
});

// 3) Go strana vyrobí reports/go-golden.json. Balíček internal/contracts
// zakládá P02 (runnery) a naplňuje P09 (implementace), viz rozhodnutí R1.
try {
  execFileSync('go', ['test', './internal/contracts/...', '-run', 'TestGolden'], {
    cwd: path.resolve(process.cwd(), 'apps/sender'),
    stdio: 'inherit',
  });
} catch {
  fail(['go test ./internal/contracts/... -run TestGolden selhal.', 'Runnery vlastní plán P02.']);
}

// 4) Parita obou reportů plus pokrytí povinných chybových kódů.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:parity',
  owner: 'P02',
  purpose: 'porovnání reportů obou jazyků a pokrytí chybových kódů',
});

ok('golden fixtures prošly na obou stranách a parita reportů sedí');
