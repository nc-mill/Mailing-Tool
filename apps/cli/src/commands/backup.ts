import { parseArgs } from 'node:util';
import {
  DumpRoleBlindError,
  keyringEnvFromConfig,
  listBackups,
  loadOpsKeyring,
  pruneBackups,
  runBackup,
  verifyBackup,
} from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

const KEY_WARNING =
  'Šifrovací klíč v záloze schválně není. Uložte si zvlášť celý keyring, tedy SECRET_KEY ' +
  'i všechna předchozí pokolení ze SECRET_KEY_PREVIOUS. Bez starých pokolení přestanou platit ' +
  'otisky smazaných adres a smazaní lidé se vrátí prvním dalším importem.';

export async function runBackupCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  const adminUrl = config.DATABASE_URL_MIGRATOR;
  if (!adminUrl) {
    streams.stderr(
      'Záloha potřebuje DATABASE_URL_MIGRATOR. Aplikační role podléhá row level security ' +
        'a pg_dump pod ní skončí chybou "query would be affected by row-level security policy".',
    );
    return EXIT_CONFIG;
  }

  const [sub, ...rest] = argv;

  if (sub === 'verify') {
    const dir = rest.find((a) => !a.startsWith('--'));
    if (!dir) {
      streams.stderr('Použití: mlain backup verify <adresář>');
      return EXIT_USAGE;
    }
    const report = await verifyBackup({ backupDir: dir, adminUrl });
    if (report.ok) {
      streams.stdout(`Záloha ${dir} je v pořádku.`);
      return EXIT_OK;
    }
    streams.stderr(`Záloha ${dir} NEPROŠLA ověřením:`);
    for (const p of report.problems) streams.stderr(`  - ${p}`);
    return 1;
  }

  if (sub === 'list') {
    const entries = await listBackups(config.BACKUP_DIR);
    if (entries.length === 0) {
      streams.stdout('Zatím žádná záloha.');
      return EXIT_OK;
    }
    for (const e of entries) streams.stdout(`${e.name}\t${e.createdAt.toISOString()}`);
    return EXIT_OK;
  }

  const { values } = parseArgs({
    args: [...argv],
    options: { 'skip-prune': { type: 'boolean', default: false } },
    allowPositionals: true,
  });

  const keyring = loadOpsKeyring(keyringEnvFromConfig(config));
  let result;
  try {
    result = await runBackup({
      databaseUrl: adminUrl,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      now: new Date(),
      postBackupHook: `${config.DATA_DIR}/hooks/post-backup.sh`,
    });
  } catch (err) {
    // Pojistka proti tiché prázdné záloze. Její hláška JE ten výstup, kvůli
    // kterému existuje, takže se vypisuje sama za sebe, ne jako pád procesu
    // se stackem. Provozovatel z ní musí poznat, co nastavit.
    if (err instanceof DumpRoleBlindError) {
      streams.stderr(err.message);
      return EXIT_CONFIG;
    }
    throw err;
  }
  streams.stdout(`Záloha hotová: ${result.dir}`);
  streams.stdout(`Kontaktů v záloze: ${result.manifest.row_counts['contacts']}`);
  streams.stdout(KEY_WARNING);

  if (values['skip-prune'] !== true) {
    const deleted = await pruneBackups(config.BACKUP_DIR, {
      now: new Date(),
      retentionDays: config.BACKUP_RETENTION_DAYS,
    });
    if (deleted.length > 0) streams.stdout(`Smazané staré zálohy: ${deleted.join(', ')}`);
  }
  return EXIT_OK;
}
