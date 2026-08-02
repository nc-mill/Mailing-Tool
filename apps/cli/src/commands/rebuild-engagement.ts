import { parseArgs } from 'node:util';
import { rebuildEngagement } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

export async function runRebuildEngagementCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      workspace: { type: 'string' },
      'batch-size': { type: 'string', default: '5000' },
    },
    allowPositionals: false,
  });
  if (!values.workspace) {
    streams.stderr('Použití: mlain rebuild-engagement --workspace <id>');
    return EXIT_USAGE;
  }
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  // Přepočet čte a zapisuje contact_engagement, contacts a message_engagement,
  // tedy tabulky s ws_isolation. Pod aplikační rolí bez kontextu by prošel,
  // zpracoval nula kontaktů a ohlásil hotovo. Proto migrátor.
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Přepočet vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí by kvůli row level ' +
        'security zpracoval nula kontaktů a skončil hlášením „hotovo".',
    );
    return EXIT_CONFIG;
  }
  // Přepočet stojí na `recomputeContactEngagement`, kterou podle rozhraní
  // I→P10.1 dodává část 5 a zatím v repozitáři není. `rebuildEngagement` na to
  // shodí srozumitelnou výjimku, jenže neodchycená výjimka znamená pro uživatele
  // plný stacktrace Node a exit kód 1, tedy totéž, co skutečná porucha.
  // Odlišit „tenhle build to neumí" od „tohle se rozbilo" je celý smysl
  // exit kódu 69, který ostatní nedodané příkazy vracejí taky.
  try {
    const report = await rebuildEngagement({
      adminUrl: config.DATABASE_URL_MIGRATOR,
      workspaceId: values.workspace,
      batchSize: Number(values['batch-size']),
      onProgress: (n) => streams.stdout(`Zpracováno ${n} kontaktů`),
    });
    streams.stdout(`Hotovo. Zpracováno ${report.processed} kontaktů v ${report.batches} dávkách.`);
    return EXIT_OK;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes('recomputeContactEngagement')) {
      streams.stderr(message);
      return EXIT_UNAVAILABLE;
    }
    throw error;
  }
}
