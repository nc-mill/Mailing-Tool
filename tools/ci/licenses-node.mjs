#!/usr/bin/env node
// Job licenses-node. Projekt je MIT, GPL, LGPL a AGPL jsou zakázané
// (hlavní specifikace, kapitola 9; část 1, kapitola 3.15).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail, ok } from './lib/report.mjs';

const ALLOWED = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
];

// Explicitní blocklist s vysvětlením, aby se nikdo nemusel ptát.
const BLOCKED = [
  'GPL-*',
  'AGPL-*',
  'LGPL-*',
  'SSPL-*',
  'BUSL-*',
  'Elastic-2.0',
  'Sustainable Use License',
  'CC-BY-NC-*',
];

const allowFile = path.resolve(process.cwd(), 'licenses.allow.json');
const errors = [];
let exceptions = [];

if (fs.existsSync(allowFile)) {
  ({ exceptions = [] } = JSON.parse(fs.readFileSync(allowFile, 'utf8')));
  const today = new Date();
  for (const exception of exceptions) {
    for (const field of ['package', 'license', 'reason', 'approved_by', 'expires_at']) {
      if (!exception[field]) {
        errors.push(`výjimka pro ${exception.package ?? '(bez jména)'}: chybí pole ${field}`);
      }
    }
    // Výjimka bez expires_at neprojde validací. Bez toho se z výjimek stane
    // trvalá díra (část 1, kapitola 3.15).
    if (exception.expires_at && new Date(exception.expires_at) < today) {
      errors.push(`výjimka pro ${exception.package} vypršela ${exception.expires_at}`);
    }
  }
}

if (errors.length > 0) {
  fail(['licenses-node našel problémy v licenses.allow.json:', ...errors.map((l) => `  ${l}`)]);
}

if (!fs.existsSync(path.resolve(process.cwd(), 'node_modules'))) {
  ok('licenses.allow.json je platný; kontrola balíčků proběhne po pnpm install');
}

/**
 * Rozvinutí výjimek na konkrétní `název@verze`.
 *
 * PROČ TO NEJDE JINAK: `--excludePackages` v license-checkeru 25 přijímá jen
 * přesné dvojice `název@verze`. Samotné jméno bez verze **neúčinkuje**, balíček
 * bránou stejně propadne; ověřeno spuštěním. Zapisovat verze do
 * licenses.allow.json ale nejde: nativní balíčky sharpu jsou per platforma
 * (na Ubuntu runneru linux-x64, v alpine image linuxmusl-x64, na vývojářském
 * Macu darwin-arm64) a verze se mění s každým patchem sharpu. Skript proto
 * jména rozvine sám podle toho, co je opravdu nainstalované.
 */
function resolveExceptions() {
  const installed = JSON.parse(
    execFileSync(
      'pnpm',
      ['exec', 'license-checker', '--production', '--excludePrivatePackages', '--json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  const matches = (name, pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

  const excluded = [];
  for (const key of Object.keys(installed)) {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const exception = exceptions.find((item) => matches(name, item.package));
    if (!exception) continue;
    // Balíček se pod existující výjimkou nesmí tiše přelicencovat. Kdyby
    // @img/sharp-libvips přešel na AGPL, tenhle řádek to zachytí.
    const actual = String(installed[key].licenses);
    if (actual !== exception.license) {
      errors.push(
        `${key} má licenci "${actual}", ale výjimka je vystavená na "${exception.license}". Znovu ji posuď, neupravuj naslepo.`,
      );
    }
    excluded.push(key);
  }
  return excluded;
}

const excluded = resolveExceptions();
if (errors.length > 0) {
  fail(['licenses-node našel problémy:', ...errors.map((l) => `  ${l}`)]);
}
if (excluded.length > 0) {
  console.log(`Uplatněné výjimky: ${excluded.join(', ')}`);
}

try {
  // Pole argumentů, ne shell: interpolace do shellu je injekce.
  // --excludePrivatePackages: všechny balíčky monorepa jsou private a
  //   license-checker je jinak hlásí jako UNLICENSED a brána spadne na nich.
  // --excludePackages: BEZ TOHOHLE ARGUMENTU by se licenses.allow.json jen
  //   validoval a do kontroly by se nikdy nedostal, takže by výjimka fakticky
  //   nic neodblokovala. To byl skutečný stav dřívějšího znění.
  const args = [
    'exec',
    'license-checker',
    '--production',
    '--excludePrivatePackages',
    '--onlyAllow',
    ALLOWED.join(';'),
    '--summary',
  ];
  if (excluded.length > 0) args.push('--excludePackages', excluded.join(';'));
  execFileSync('pnpm', args, { stdio: 'inherit' });
} catch {
  fail([
    'license-checker našel závislost mimo whitelist.',
    `Povolené: ${ALLOWED.join(', ')}`,
    `Zakázané: ${BLOCKED.join(', ')}`,
    'MIT distribuce s GPL knihovnou je licenční konflikt, ne preference.',
    'Výjimku lze zapsat do licenses.allow.json, ale musí být na JMÉNO BALÍČKU,',
    'nikdy na licenci, a musí mít expires_at.',
  ]);
}
ok(`všechny závislosti mají povolenou licenci, uplatněno ${excluded.length} výjimek`);
