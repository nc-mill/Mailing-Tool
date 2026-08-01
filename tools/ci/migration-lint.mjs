#!/usr/bin/env node
// Lint migrací, součást jobu lint. Vynucuje konvence z části 1, kapitoly 3.13.
import fs from 'node:fs';
import path from 'node:path';
import { fail, listFiles, ok, skip } from './lib/report.mjs';

const MIGRATIONS = path.resolve(process.cwd(), 'packages/db/migrations');

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

  // Konvence 2.4: kompilované SQL nesmí volat now(). Čas dodává aplikace,
  // jinak se výsledek migrace liší podle okamžiku spuštění.
  const withoutComments = text.replace(/--[^\n]*\n/g, '\n');
  if (
    /\bnow\s*\(\s*\)/i.test(withoutComments) &&
    !/DEFAULT\s+now\s*\(\s*\)/i.test(withoutComments)
  ) {
    errors.push(`${file}: volání now() mimo DEFAULT je zakázané (konvence 2.4)`);
  }

  if (/^\s*DROP\s+TABLE/im.test(withoutComments) && !/IF\s+EXISTS/i.test(withoutComments)) {
    errors.push(`${file}: DROP TABLE musí mít IF EXISTS`);
  }
}

if (errors.length > 0) fail(['migration-lint našel problémy:', ...errors.map((l) => `  ${l}`)]);
ok(`${files.length} migrací prošlo lintem`);
