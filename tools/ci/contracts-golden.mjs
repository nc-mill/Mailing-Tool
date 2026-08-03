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
// reports/ts-golden-*.json a reports/go-golden-*.json. Reporty musí vzniknout
// PŘED ním, proto se v tomhle pořadí spouští všechny tři kroky.
//
// KAŽDÝ KROK, KTERÝ MÁ NĚCO VYROBIT, SE OVĚŘUJE VÝROBKEM, NE NÁVRATOVÝM KÓDEM
// (nález I96). Dřívější znění pouštělo Go stranu jako
// `go test ./internal/contracts/... -run TestGolden`. Ani jedno nesedělo:
// balíček internal/contracts drží jen runnery a žádný jeho test se tak
// nejmenuje, kdežto testy TestGolden* žijí v balíčcích s produkční
// implementací (internal/token, internal/credentials, internal/liquidx,
// internal/markers, internal/mimebuild, internal/outbox). Go proto pokaždé
// vypsalo `[no tests to run]`, skončilo nulou a job to vzal jako úspěch.
// Reporty Go strany tedy nevznikly nikdy a parita se porovnávala proti
// zmrazeným artefaktům z dřívějška.
//
// Proto se reporty na začátku SMAŽOU a po každém kroku se ověří, že skutečně
// vznikly. Sekce se nevyjmenovávají natvrdo: co vyrobí TypeScript strana, to
// musí vyrobit i Go strana. Druhý seznam sekcí by byl třetí zdroj pravdy vedle
// fixtur a check-parity.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const REPORTS = path.join(CONTRACTS, 'reports');

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

/** Sekce, pro které daný jazyk zapsal report. Adresář reports/ je mimo git. */
function sections(language) {
  if (!fs.existsSync(REPORTS)) return [];
  const prefix = `${language}-golden-`;
  return fs
    .readdirSync(REPORTS)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => name.slice(prefix.length, -'.json'.length))
    .sort();
}

// Reporty z dřívějších běhů se zahazují. Jinak nejde odlišit krok, který
// doopravdy proběhl, od kroku, který nespustil nic a nechal ležet, co tam bylo.
fs.rmSync(REPORTS, { recursive: true, force: true });

// 2) TypeScript strana vyrobí reports/ts-golden-*.json.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:golden',
  owner: 'P02',
  purpose: 'runnery golden fixtures nad TypeScript implementací',
});

const tsSections = sections('ts');
if (tsSections.length === 0) {
  fail([
    'test:golden proběhl, ale nezapsal ani jeden reports/ts-golden-*.json.',
    'Runnery TypeScript strany buď neběžely, nebo report nezapisují.',
    'Zelený běh bez reportu je k nerozeznání od běhu, který nic nespustil.',
    'Vlastní to plán P02.',
  ]);
}

// 3) Go strana vyrobí reports/go-golden-*.json. Testy TestGolden* NEJSOU
// v internal/contracts (tam jsou jen runnery), ale v balíčcích s produkční
// implementací, proto ./internal/... a ne ./internal/contracts/...
//
// `-count=1` VYPÍNÁ CACHE GO TESTŮ a je tu nutnost, ne zvyk. Balíček, jehož
// vstupy se od minula nezměnily, Go přeskočí a vypíše `(cached)`. Test se pak
// nespustí, report nezapíše a krok zase jen tiše skončí nulou. Naměřeno:
// po opravě jedné fixture přepsala Go strana jediný report ze šesti a zbylých
// pět zůstalo z minulého běhu.
try {
  execFileSync('go', ['test', '-count=1', './internal/...', '-run', 'TestGolden'], {
    cwd: path.resolve(process.cwd(), 'apps/sender'),
    stdio: 'inherit',
  });
} catch {
  fail([
    'go test -count=1 ./internal/... -run TestGolden selhal.',
    'Runnery vlastní plán P02, produkční implementaci plán P09.',
  ]);
}

const goSections = sections('go');
if (goSections.length === 0) {
  fail([
    'go test -count=1 ./internal/... -run TestGolden skončil nulou, ale nezapsal ani jeden',
    'reports/go-golden-*.json. Nejčastější příčina: filtr -run neodpovídá žádnému',
    'testu, takže Go vypíše "[no tests to run]" a skončí úspěchem.',
    'Testy, které reporty zapisují, se jmenují TestGolden* a jsou v balíčcích',
    'internal/token, internal/credentials, internal/liquidx, internal/markers,',
    'internal/mimebuild a internal/outbox.',
  ]);
}

const chybi = tsSections.filter((section) => !goSections.includes(section));
const navic = goSections.filter((section) => !tsSections.includes(section));
if (chybi.length > 0 || navic.length > 0) {
  fail([
    'Množina sekcí se mezi jazyky rozešla, parita by porovnávala jen půlku.',
    `  TypeScript: ${tsSections.join(', ') || '(žádná)'}`,
    `  Go:         ${goSections.join(', ') || '(žádná)'}`,
    ...(chybi.length > 0 ? [`  chybí na Go straně: ${chybi.join(', ')}`] : []),
    ...(navic.length > 0 ? [`  navíc na Go straně: ${navic.join(', ')}`] : []),
  ]);
}

// 4) Parita obou reportů plus pokrytí povinných chybových kódů.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:parity',
  owner: 'P02',
  purpose: 'porovnání reportů obou jazyků a pokrytí chybových kódů',
});

ok(`golden fixtures prošly na obou stranách, sekce: ${tsSections.join(', ')}`);
