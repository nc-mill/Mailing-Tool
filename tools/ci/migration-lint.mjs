#!/usr/bin/env node
// Lint migrací, součást jobu lint. Vynucuje konvence z části 1, kapitoly 3.13.
import fs from 'node:fs';
import path from 'node:path';
import { fail, listFiles, ok, skip } from './lib/report.mjs';

const MIGRATIONS = path.resolve(process.cwd(), 'packages/db/migrations');

/**
 * Rozdělí SQL na jednotlivé příkazy a cestou zahodí komentáře.
 *
 * PROČ TO NEJDE NA `text.split(';')`. Migrace 0004 začíná blokem `DO $$ ...
 * END $$;`, uvnitř kterého je pět středníků a řetězec s uvozovkami. Naivní
 * dělení z něj udělá pět útržků, u kterých už nejde poznat, jaký příkaz to
 * původně byl, takže každé pravidlo, které se ptá „co je tohle za příkaz",
 * dostane špatnou odpověď. Splitter proto přeskakuje řetězce (`'…'` včetně
 * zdvojeného apostrofu), uvozené identifikátory (`"…"`), dollar-quoting
 * (`$$…$$`, `$tag$…$tag$`) a oba druhy komentářů.
 *
 * Escape zpětným lomítkem se řeší jen u řetězců s prefixem `E`, protože
 * jinde ho PostgreSQL se standardním `standard_conforming_strings` nezná.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      // Komentář se nahrazuje mezerou, ne prázdnem: `a --pozn\nb` nesmí
      // splynout v `ab`.
      current += ' ';
      index = end === -1 ? sql.length : end;
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2);
      current += ' ';
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    const dollarTag = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
    if (dollarTag) {
      const tag = dollarTag[0];
      const end = sql.indexOf(tag, index + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    const character = sql[index];
    if (character === "'" || character === '"') {
      const backslashEscapes = character === "'" && /[eE]$/.test(sql.slice(0, index));
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (backslashEscapes && sql[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === character) {
          if (sql[cursor + 1] === character) {
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      current += sql.slice(index, cursor);
      index = cursor;
      continue;
    }

    if (character === ';') {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  statements.push(current);
  return statements
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Začátek příkazu do hlášky, aby bylo vidět, který z nich pravidlo chytilo. */
function label(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  return normalized.length > 70 ? `${normalized.slice(0, 70)}…` : normalized;
}

if (!fs.existsSync(MIGRATIONS)) {
  skip('packages/db/migrations zatím neexistuje, migrace dodá plán P03');
}

const errors = [];
const files = listFiles(MIGRATIONS, '.sql');

for (const file of files) {
  const text = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  const noTransaction = /^--\s*mlain:no-transaction\s*$/m.test(text);
  const statements = text
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (/CREATE\s+INDEX\s+CONCURRENTLY/i.test(text) && !noTransaction) {
    errors.push(`${file}: CREATE INDEX CONCURRENTLY vyžaduje direktivu -- mlain:no-transaction`);
  }

  if (noTransaction) {
    // Migrace mimo transakci může spadnout uprostřed a nechat databázi
    // v částečném stavu, takže smí obsahovat jen idempotentní příkazy.
    for (const statement of statements) {
      // Odstraní komentářové řádky UVNITŘ příkazu (např. -- mlain:no-transaction
      // na prvním řádku), ne celý příkaz. Filtr podle prefixu celého bloku by
      // smazal i skutečné SQL za direktivou, protože blok jako celek "začíná"
      // komentářem, i když další řádek je CREATE INDEX.
      const commands = statement
        .split(';')
        .map((command) =>
          command
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
            .trim(),
        )
        .filter((command) => command.length > 0);
      for (const command of commands) {
        if (/^CREATE\s+INDEX/i.test(command) && !/IF\s+NOT\s+EXISTS/i.test(command)) {
          errors.push(
            `${file}: v no-transaction migraci musí mít CREATE INDEX klauzuli IF NOT EXISTS`,
          );
        }
        if (/^DROP\s+INDEX/i.test(command) && !/IF\s+EXISTS/i.test(command)) {
          errors.push(`${file}: v no-transaction migraci musí mít DROP INDEX klauzuli IF EXISTS`);
        }
      }
    }
  }

  // Konvence 2.4 (specifikace, část 1, kapitola 2.4) zakazuje čtení hodin
  // tam, kde by výsledek závisel na okamžiku spuštění: „now(),
  // current_timestamp ani CURRENT_DATE se ve vygenerovaném SQL nesmí
  // objevit". Míří to na SQL sestavené z uživatelské definice (segmenty,
  // publikum kampaně), kde čas dodává povinný parametr asOf, a v migraci
  // platí totéž pro datové příkazy: INSERT, který si vezme čas z databáze,
  // zapíše pokaždé jinou hodnotu.
  //
  // DVĚ VÝJIMKY, obě proto, že se výraz nevyhodnocuje při migraci:
  //   * DEFAULT now() je předpis pro budoucí zápisy, ne hodnota (viz 2.2,
  //     kde ho spec u každé tabulky přímo předepisuje);
  //   * predikát politiky (CREATE/ALTER POLICY) se vyhodnocuje při KAŽDÉM
  //     dotazu, takže `expires_at > now()` u pozvánky nebo
  //     `last_used_at >= now() - interval '1 minute'` u API klíče je jediný
  //     způsob, jak takovou politiku vůbec napsat. Zakázat ho neznamená
  //     zbavit se závislosti na čase, ale politiku nemít.
  //
  // Vyhodnocuje se PO PŘÍKAZECH. Dokud se pravidlo ptalo celého souboru,
  // stačil kdekoli jeden DEFAULT now() a všechna ostatní volání v tomtéž
  // souboru prošla, kdežto soubor bez jediného DEFAULT (0004, samé
  // politiky) padal celý.
  for (const statement of splitStatements(text)) {
    if (/^(?:CREATE|ALTER)\s+POLICY\b/i.test(statement)) continue;
    // Hranice slova patří jen před now a kolem klíčových slov bez závorek.
    // Za `now()` je poslední znak `)`, takže koncové \b by vyžadovalo, aby
    // hned následoval písmenný znak, a `now())` ani `now() - interval` by
    // pravidlu utekly. Právě tím bylo původní pravidlo bezzubé: nechytalo
    // now() nikde, jen padalo na souborech bez DEFAULT.
    const CLOCK = /\bnow\s*\(\s*\)|\b(?:current_timestamp|current_date)\b/i;
    const withoutDefaults = statement.replace(
      /\bDEFAULT\s+(?:now\s*\(\s*\)|current_timestamp\b|current_date\b)/gi,
      'DEFAULT',
    );
    if (CLOCK.test(withoutDefaults)) {
      errors.push(
        `${file}: čtení hodin mimo DEFAULT a mimo predikát politiky je zakázané (konvence 2.4): ${label(statement)}`,
      );
    }

    if (/^DROP\s+TABLE\b/i.test(statement) && !/\bIF\s+EXISTS\b/i.test(statement)) {
      errors.push(`${file}: DROP TABLE musí mít IF EXISTS: ${label(statement)}`);
    }
  }
}

if (errors.length > 0) fail(['migration-lint našel problémy:', ...errors.map((l) => `  ${l}`)]);
ok(`${files.length} migrací prošlo lintem`);
