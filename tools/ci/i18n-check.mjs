#!/usr/bin/env node
// Job i18n-check. Shoda klíčů mezi jazyky a validita ICU výrazů.
// Zdroj pravdy je en (část 1, kapitola 3.9). Akceptační kritéria 51 a 53.
import fs from 'node:fs';
import path from 'node:path';
import { fail, flattenKeys, listFiles, ok, skip } from './lib/report.mjs';

const MESSAGES = path.resolve(process.cwd(), 'packages/i18n/messages');

if (!fs.existsSync(MESSAGES)) {
  skip('packages/i18n/messages zatím neexistuje, katalogy dodá plán P05');
}

const locales = fs
  .readdirSync(MESSAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!locales.includes('en')) {
  fail('packages/i18n/messages/en neexistuje, přitom je zdrojem pravdy (3.9).');
}

function readCatalog(locale) {
  const result = new Map();
  for (const file of listFiles(path.join(MESSAGES, locale), '.json')) {
    const namespace = file.replace(/\.json$/, '').replace(/\//g, '.');
    const parsed = JSON.parse(fs.readFileSync(path.join(MESSAGES, locale, file), 'utf8'));
    for (const key of flattenKeys(parsed)) result.set(`${namespace}.${key}`, true);
  }
  return result;
}

/**
 * Minimální kontrola ICU: závorky musí být vyvážené a každá konstrukce plural
 * nebo select musí mít větev other. Plná validace patří do runtime knihovny,
 * tohle chytá překlepy, které by jinak spadly až u uživatele.
 *
 * Čeština má kategorie one, few, many, other; many je pro desetinná čísla
 * a musí být vyplněná, jinak 1,5 kontaktu vypadne na other (3.9).
 */
function icuProblems(text) {
  const problems = [];
  let depth = 0;
  for (const character of text) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0) return ['nevyvážené složené závorky'];
  }
  if (depth !== 0) problems.push('nevyvážené složené závorky');
  if (/\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(text) && !/\bother\s*\{/.test(text)) {
    problems.push('konstrukce plural nebo select nemá větev other');
  }
  return problems;
}

const reference = readCatalog('en');
const errors = [];

for (const locale of locales) {
  if (locale === 'en') continue;
  const catalog = readCatalog(locale);
  for (const key of reference.keys()) {
    if (!catalog.has(key)) errors.push(`${locale}: chybí klíč ${key}`);
  }
  for (const key of catalog.keys()) {
    if (!reference.has(key)) errors.push(`${locale}: přebývá klíč ${key}, který v en není`);
  }
}

for (const locale of locales) {
  for (const file of listFiles(path.join(MESSAGES, locale), '.json')) {
    const raw = fs.readFileSync(path.join(MESSAGES, locale, file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push(`${locale}/${file}: neplatný JSON, ${error.message}`);
      continue;
    }
    const walk = (value, prefix) => {
      for (const [key, item] of Object.entries(value)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (typeof item === 'string') {
          for (const problem of icuProblems(item)) {
            errors.push(`${locale}/${file}: klíč ${full}: ${problem}`);
          }
        } else if (item !== null && typeof item === 'object') {
          walk(item, full);
        }
      }
    };
    walk(parsed, '');
  }
}

if (errors.length > 0) fail(['i18n-check našel problémy:', ...errors.map((line) => `  ${line}`)]);
ok(`${reference.size} klíčů, ${locales.length} jazyků, katalogy jsou v souladu`);
