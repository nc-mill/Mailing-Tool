import { parseArgs } from 'node:util';
import { resetPassword, UserNotFoundError } from '@mlain/core/ops';
import { EXIT_OK, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

export async function runResetPasswordCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { password: { type: 'string' } },
    allowPositionals: true,
  });
  const email = positionals[0];
  if (!email) {
    streams.stderr('Použití: mlain reset-password <e-mail> [--password <heslo>]');
    return EXIT_USAGE;
  }
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  try {
    // `users` a `sessions` jsou na whitelistu tabulek BEZ RLS (P03), takže
    // tenhle příkaz jako jediný z osmi vystačí s aplikační rolí. Je to
    // záměr: obnova hesla musí jít i v instalaci, kde migrátorské URL
    // nikdo nenastavil.
    const report = await resetPassword({
      databaseUrl: config.DATABASE_URL,
      email,
      password: values.password ?? null,
    });
    if (report.generatedPassword) {
      streams.stdout(`Nové heslo pro ${email}:\n\n  ${report.generatedPassword}\n`);
      streams.stdout('Přihlaste se s ním a hned si ho v profilu změňte.');
    } else {
      streams.stdout(`Heslo pro ${email} je nastavené.`);
    }
    streams.stdout('Všechny dosavadní relace uživatele jsou zrušené.');
    return EXIT_OK;
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      streams.stderr(err.message);
      return 1;
    }
    throw err;
  }
}
