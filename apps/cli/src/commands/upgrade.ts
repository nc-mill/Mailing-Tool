import {
  keyringEnvFromConfig,
  loadOpsKeyring,
  ProcessesStillRunningError,
  runUpgrade,
} from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_TEMPFAIL } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import { reportMigrationFailure } from './migration-failure';
import type { CliStreams } from '../dispatch';

export async function runUpgradeCommand(
  streams: CliStreams,
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr('Upgrade vyžaduje DATABASE_URL_MIGRATOR.');
    return EXIT_CONFIG;
  }
  const keyring = loadOpsKeyring(keyringEnvFromConfig(config));
  try {
    const report = await runUpgrade({
      appUrl: config.DATABASE_URL,
      adminUrl: config.DATABASE_URL_MIGRATOR,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      dataDir: config.DATA_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      readinessUrl: `${config.APP_URL}/api/health/ready`,
      now: new Date(),
    });
    streams.stdout(`Záloha před upgradem: ${report.backupDir}`);
    streams.stdout(`Kroky, které proběhly: ${report.steps.join(', ')}`);
    streams.stdout(`Readiness: ${report.readinessOk ? 'v pořádku' : 'zatím ne'}`);
    streams.stdout('');
    streams.stdout(report.nextSteps);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof ProcessesStillRunningError) {
      streams.stderr(err.message);
      return EXIT_TEMPFAIL;
    }
    // Sjednoceno s `mlain migrate`: selhaná migrace má svůj exit kód (3, 4, 5
    // nebo 75), ne kód 1 se stackem. Upgrade padal právě tak, přestože volá
    // týž runner, a protože běží ručně po zastavení procesů, byl ten stack
    // jediné, co provozovatel dostal.
    const code = reportMigrationFailure(streams, err, [
      'Upgrade se zastavil za zálohou, schéma se NEZMĚNILO nebo se změnilo jen zčásti.',
      'Procesy nechte zastavené a databázi nespouštějte proti nové verzi image.',
      'Záloha z tohohle běhu je hotová, proběhla před migrací; vypíše ji mlain backup list.',
      'Po odstranění příčiny spusťte mlain upgrade znovu, kroky jsou opakovatelné.',
    ]);
    if (code !== null) return code;
    throw err;
  }
}
