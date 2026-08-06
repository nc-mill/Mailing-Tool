import { parseArgs } from 'node:util';
import { decideKeyId, generateSecretKey, keyIdsInEnv, rotationRunbook } from '@mlain/core/ops';
import { EXIT_OK, EXIT_USAGE } from '../exit-codes';
import type { CliStreams } from '../dispatch';

/**
 * `mlain genkey` vyrobí nový klíč pro DALŠÍ pokolení keyringu.
 *
 * `--id` NEMÁ výchozí hodnotu, a je to ta oprava, kvůli které tenhle komentář
 * existuje. Dřív měl výchozí `2`, takže kdo přepínač vynechal podruhé, vyrobil
 * druhý různý klíč se stejným `key_id`. Obálky zašifrované tím prvním se pak
 * nedají přečíst a NIC to neohlásí: `key_id` sedí, takže se sáhne po klíči,
 * který k datům nepatří, a dešifrování skončí jako poškozená data. Nevratně.
 *
 * Číslo se odvozuje z prostředí, ne z databáze. Zdůvodnění je u `keyIdsInEnv`:
 * příkaz se pouští právě ve chvílích, kdy na databázi spolehnutí není.
 */
export async function runGenkeyCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let values: { id?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { id: { type: 'string' } },
      allowPositionals: false,
    }));
  } catch (error) {
    // `--id` bez hodnoty vyhodí výjimku z parseArgs. Bez tohohle bloku by
    // z toho byl pád se stackem místo věty o použití.
    streams.stderr(error instanceof Error ? error.message : String(error));
    streams.stderr('Použití: mlain genkey [--id <n>]');
    return EXIT_USAGE;
  }

  const known = keyIdsInEnv({
    SECRET_KEY: env['SECRET_KEY'],
    SECRET_KEY_PREVIOUS: env['SECRET_KEY_PREVIOUS'],
  });
  const decision = decideKeyId(values.id, known);
  if (!decision.ok) {
    for (const line of decision.message.split('\n')) streams.stderr(line);
    return EXIT_USAGE;
  }

  for (const note of decision.notes) streams.stdout(note);
  if (decision.notes.length > 0) streams.stdout('');
  for (const line of rotationRunbook(decision.keyId, generateSecretKey(), known).split('\n')) {
    streams.stdout(line);
  }
  return EXIT_OK;
}
