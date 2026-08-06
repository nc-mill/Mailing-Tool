import { EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE } from './exit-codes';
import { COMMANDS, findCommand, suggest } from './registry';
import { runConfigCheck } from './commands/config-check';
import { runHealthcheck } from './commands/healthcheck';
import { runMigrateCommand } from './commands/migrate';
import { runPartitionsCommand } from './commands/partitions';
import { runBackupCommand } from './commands/backup';
import { runDoctorCommand } from './commands/doctor';
import { runGenkeyCommand } from './commands/genkey';
import { runRebuildEngagementCommand } from './commands/rebuild-engagement';
import { runRedressBrandCommand } from './commands/redress-brand';
import { runResetPasswordCommand } from './commands/reset-password';
import { runRestoreCommand } from './commands/restore';
import { runRotateCredentialsCommand } from './commands/rotate-credentials';
import { runUpgradeCommand } from './commands/upgrade';

export interface CliStreams {
  stdout(line: string): void;
  stderr(line: string): void;
  env?: Record<string, string | undefined>;
}

function help(streams: CliStreams): void {
  streams.stdout('mlain <příkaz> [argumenty]');
  streams.stdout('');
  streams.stdout('Příkazy:');
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const command of COMMANDS) {
    const suffix = command.implemented ? '' : `  (not implemented, dodá plán ${command.owner})`;
    streams.stdout(`  ${command.name.padEnd(width)}  ${command.summary}${suffix}`);
  }
  streams.stdout('');
  streams.stdout('Nápověda k příkazu: mlain <příkaz> --help');
}

export async function dispatch(argv: readonly string[], streams: CliStreams): Promise<number> {
  const env = streams.env ?? process.env;
  const [name, ...rest] = argv;

  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    help(streams);
    return name === undefined ? EXIT_USAGE : EXIT_OK;
  }

  const command = findCommand(name);
  if (!command) {
    const hint = suggest(name);
    streams.stderr(`mlain: neznámý příkaz "${name}".${hint ? ` Nemyslel jsi "${hint}"?` : ''}`);
    streams.stderr('Seznam příkazů: mlain --help');
    return EXIT_USAGE;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    streams.stdout(command.usage);
    streams.stdout('');
    streams.stdout(command.summary);
    // Přepínače vypisuje TENHLE blok, protože `--help` se zachytává tady,
    // dřív než se příkaz vůbec zavolá. Dokud registr přepínače neznal, neměla
    // je nápověda odkud vzít a `mlain doctor --json` a `--strict` nebyly
    // popsané nikde, přestože `--strict` mění exit kód.
    if (command.options && command.options.length > 0) {
      streams.stdout('');
      streams.stdout('Přepínače:');
      const width = Math.max(...command.options.map((option) => option.flag.length));
      for (const option of command.options) {
        streams.stdout(`  ${option.flag.padEnd(width)}  ${option.summary}`);
      }
    }
    if (!command.implemented) {
      streams.stdout('');
      streams.stdout(`Tenhle příkaz zatím není implementovaný. Dodá ho plán ${command.owner}.`);
    }
    return EXIT_OK;
  }

  if (!command.implemented) {
    streams.stderr(
      `mlain ${command.name}: not implemented in this build. Příkaz je deklarovaný v registru, ale jeho tělo dodá plán ${command.owner}.`,
    );
    streams.stderr(`Použití, až bude hotový: ${command.usage}`);
    return EXIT_UNAVAILABLE;
  }

  switch (command.name) {
    case 'version': {
      streams.stdout(env['IMAGE_VERSION'] ?? '0.0.0-dev');
      return EXIT_OK;
    }
    case 'config': {
      if (rest[0] !== 'check') {
        streams.stderr(`mlain config: očekávám podpříkaz "check". Použití: ${command.usage}`);
        return EXIT_USAGE;
      }
      return runConfigCheck(streams, env);
    }
    case 'healthcheck': {
      return runHealthcheck(streams, env);
    }
    // Osm provozních příkazů z P16. Rozhraní I→P01.1: tělo příkazu vlastní
    // plán, který ho dodává, tahle větev je jen zapojení do dispatcheru.
    case 'migrate': {
      return runMigrateCommand(streams, rest, env);
    }
    case 'backup': {
      return runBackupCommand(streams, rest, env);
    }
    case 'restore': {
      return runRestoreCommand(streams, rest, env);
    }
    case 'doctor': {
      return runDoctorCommand(streams, rest, env);
    }
    case 'upgrade': {
      return runUpgradeCommand(streams, rest, env);
    }
    case 'rotate-credentials': {
      return runRotateCredentialsCommand(streams, rest, env);
    }
    case 'genkey': {
      return runGenkeyCommand(streams, rest, env);
    }
    case 'reset-password': {
      return runResetPasswordCommand(streams, rest, env);
    }
    case 'rebuild-engagement': {
      return runRebuildEngagementCommand(streams, rest, env);
    }
    case 'partitions': {
      return runPartitionsCommand(streams, rest, env);
    }
    case 'redress-brand': {
      return runRedressBrandCommand(streams, rest, env);
    }
    default: {
      streams.stderr(
        `mlain ${command.name}: chybí obsluha, přestože je příkaz označený jako implementovaný.`,
      );
      return EXIT_UNAVAILABLE;
    }
  }
}
