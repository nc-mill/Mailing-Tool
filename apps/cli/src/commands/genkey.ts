import { parseArgs } from 'node:util';
import { generateSecretKey, rotationRunbook } from '@mlain/core/ops';
import { EXIT_OK, EXIT_USAGE } from '../exit-codes';
import type { CliStreams } from '../dispatch';

export async function runGenkeyCommand(
  streams: CliStreams,
  argv: readonly string[],
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { id: { type: 'string', default: '2' } },
    allowPositionals: false,
  });
  const keyId = Number(values.id);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    streams.stderr('key_id musí být celé číslo od 1 do 255.');
    return EXIT_USAGE;
  }
  for (const line of rotationRunbook(keyId, generateSecretKey()).split('\n')) {
    streams.stdout(line);
  }
  return EXIT_OK;
}
