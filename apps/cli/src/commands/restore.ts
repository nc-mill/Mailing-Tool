import { parseArgs } from 'node:util';
import {
  keyringEnvFromConfig,
  loadOpsKeyring,
  RestoreRefusedError,
  restoreBackup,
} from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import { reportMigrationFailure } from './migration-failure';
import type { CliStreams } from '../dispatch';

export async function runRestoreCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      force: { type: 'boolean', default: false },
      'skip-uploads': { type: 'boolean', default: false },
      'i-know-the-key-differs': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const dir = positionals[0];
  if (!dir) {
    streams.stderr(
      'Použití: mlain restore <adresář> [--force] [--skip-uploads] [--i-know-the-key-differs]',
    );
    return EXIT_USAGE;
  }

  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Obnova vyžaduje DATABASE_URL_MIGRATOR, protože aplikační role schéma nevlastní ' +
        'a po obnově je potřeba zavolat mlain_apply_grants().',
    );
    return EXIT_CONFIG;
  }
  const keyring = loadOpsKeyring(keyringEnvFromConfig(config));

  try {
    const report = await restoreBackup({
      backupDir: dir,
      databaseUrl: config.DATABASE_URL_MIGRATOR,
      uploadsDir: config.UPLOADS_DIR,
      appVersion: config.IMAGE_VERSION,
      currentFingerprint: keyring.currentFingerprint,
      force: values.force === true,
      skipUploads: values['skip-uploads'] === true,
      acknowledgeKeyDiffers: values['i-know-the-key-differs'] === true,
    });
    streams.stdout(`Obnoveno. Porovnáno ${report.comparedTables} tabulek.`);
    if (report.rowCountDiffs.length === 0) {
      streams.stdout('Počty řádků sedí s manifestem.');
    } else {
      streams.stdout('Rozdíly proti manifestu:');
      for (const d of report.rowCountDiffs) {
        streams.stdout(`  ${d.table}: v manifestu ${d.expected}, po obnově ${d.actual}`);
      }
    }
    if (report.keyDiffers) {
      streams.stdout(
        'POZOR: obnovovalo se s jiným SECRET_KEY. Zadejte znovu přístupy k odesílání a AI klíče ' +
          'a doplňte stará pokolení do SECRET_KEY_PREVIOUS, jinak přestanou platit otisky smazaných adres.',
      );
    }
    return EXIT_OK;
  } catch (err) {
    if (err instanceof RestoreRefusedError) {
      streams.stderr(err.message);
      return 1;
    }
    // Selhaná migrace uprostřed obnovy. Bez tohohle bloku končil `mlain restore`
    // kódem 1 a stackem z `main.ts`, tedy výpisem, ze kterého se nedalo poznat,
    // co se stalo ani v jakém stavu databáze zůstala. A zůstala v tom nejhorším:
    // data obnovená, granty NE, protože `mlain_apply_grants()` se volá až za
    // migrací a pád ho přeskočil.
    const code = reportMigrationFailure(streams, err, [
      'Obnova se zastavila UPROSTŘED. Data z dumpu v databázi jsou, ale oprávnění NE:',
      'volání mlain_apply_grants() přijde až za migrací a to už neproběhlo.',
      'Aplikaci zatím nespouštějte, odpovídala by "permission denied for table contacts".',
      'Až příčinu odstraníte, spusťte obnovu znovu nad touž zálohou; je opakovatelná.',
    ]);
    if (code !== null) return code;
    throw err;
  }
}
