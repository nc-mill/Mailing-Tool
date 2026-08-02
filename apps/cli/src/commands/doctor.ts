import { parseArgs } from 'node:util';
import {
  exitCodeFor,
  formatJson,
  formatReport,
  keyringEnvFromConfig,
  runDoctor,
} from '@mlain/core/ops';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

export async function runDoctorCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  const keys = keyringEnvFromConfig(config);
  const report = await runDoctor({
    // appUrl je aplikační role a slouží JEN kontrolám, jejichž předmětem
    // ta role je: rozpočet spojení a předpoklady izolace. Data se z ní
    // nečtou, protože RLS by je bez kontextu projektu vyfiltrovala na nulu.
    appUrl: config.DATABASE_URL,
    adminUrl: config.DATABASE_URL_MIGRATOR ?? null,
    dataDir: config.DATA_DIR,
    backupDir: config.BACKUP_DIR,
    uploadsDir: config.UPLOADS_DIR,
    secretKey: keys.secretKey,
    secretKeyPrevious: keys.secretKeyPrevious,
    imageVersion: config.IMAGE_VERSION,
    now: new Date(),
  });

  streams.stdout(values.json ? formatJson(report.findings) : formatReport(report.findings));
  return exitCodeFor(report.findings, { strict: values.strict === true });
}
