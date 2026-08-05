import { parseArgs } from 'node:util';
import { runPartitionMaintenance, type RetentionReport } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

/**
 * `mlain partitions` je JEDINÉ místo, kde se v produktu uklízí odeslaná pošta.
 *
 * Do téhle chvíle retence neexistovala: `dropPartitionsBefore()` neměla
 * volajícího, fronty `retention.drop_message_partitions`
 * a `tracking.enforce_retention` byly v registru bez obsluhy
 * a `MESSAGE_RETENTION_DAYS` nikdo nečetl. `messages.render_data` s údaji
 * příjemce tedy zůstávalo v databázi navždy.
 *
 * PROČ PŘÍKAZ A NE JOB. Odpojení oddílu je DDL a worker běží pod `mlain_app`,
 * která schéma nevlastní. Aby to uměl jako job, musel by dostat právo měnit
 * schéma, a pak by kterákoli chyba v kterékoli obsluze mohla zahodit tabulku.
 * Příkaz běží pod `DATABASE_URL_MIGRATOR`, ze stejného plánovače a se stejnou
 * rolí jako `mlain migrate`. Zmíněné dvě fronty byly z registru odstraněné,
 * aby v něm nezůstalo něco, co se tváří, že uklízí, a neuklízí nic.
 *
 * SPOJENÍ JE MIMO TRANSAKCI, a je to podmínka, ne styl.
 * `ALTER TABLE ... DETACH PARTITION CONCURRENTLY` uvnitř transakčního bloku
 * skončí chybou 25001. Proto se tu otevírá holý `pg.Client` a ne `withAdminTx`.
 */
export async function runPartitionsCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let values: { 'dry-run'?: boolean; months?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'dry-run': { type: 'boolean', default: false },
        months: { type: 'string', default: '4' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    streams.stderr(`mlain partitions: ${(error as Error).message}`);
    streams.stderr('Použití: mlain partitions [--dry-run] [--months <n>]');
    return EXIT_USAGE;
  }

  const months = Number(values.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    streams.stderr(
      `mlain partitions: --months musí být celé číslo 1 až 24, dostal jsem ${values.months}`,
    );
    return EXIT_USAGE;
  }

  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const migratorUrl = loaded.config.DATABASE_URL_MIGRATOR;
  if (migratorUrl === undefined || migratorUrl === '') {
    // Bez migrátora to nejde ZKUSIT. `DATABASE_URL` je role `mlain_app`, která
    // schéma nevlastní, takže by zakládání i odpojování oddílu skončilo na
    // „permission denied", a hlavně: `messages` má row level security, takže
    // by veto pod aplikační rolí bez kontextu projektu vidělo NULA řádků,
    // usoudilo, že v oddílu nic nerozeslaného není, a oddíl by se zahodil
    // i s rozdělanou kampaní. Tichá ztráta dat je horší než odmítnutí běhu.
    streams.stderr(
      'DATABASE_URL_MIGRATOR: je povinná pro údržbu oddílů a chybí. Role z DATABASE_URL ' +
        '(mlain_app) schéma nevlastní a kvůli row level security by navíc neviděla ' +
        'zprávy, podle kterých se rozhoduje, jestli je oddíl zbytný.',
    );
    return EXIT_CONFIG;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  let report: RetentionReport;
  try {
    report = await runPartitionMaintenance({
      client,
      dryRun: values['dry-run'] === true,
      ensureMonths: months,
      env,
    });
  } finally {
    await client.end().catch(() => undefined);
  }

  printReport(streams, report);
  return EXIT_OK;
}

/** Skloňování počítaného předmětu. „1 oddíl, 2 oddíly, 5 oddílů." */
function partitions(count: number): string {
  if (count === 1) return '1 oddíl';
  if (count >= 2 && count <= 4) return `${count} oddíly`;
  return `${count} oddílů`;
}

function printReport(streams: CliStreams, report: RetentionReport): void {
  if (report.dryRun) {
    streams.stdout('REŽIM NANEČISTO: nic se nezaloží ani nezahodí.');
    streams.stdout('');
  }

  if (report.dryRun) {
    streams.stdout('Zakládání oddílů dopředu se v režimu nanečisto přeskakuje.');
  } else if (report.created.length === 0) {
    streams.stdout('Oddíly dopředu: všechny už existují, nic se nezakládalo.');
  } else {
    streams.stdout(`Oddíly dopředu: založeno ${partitions(report.created.length)}`);
    for (const name of report.created) streams.stdout(`  + ${name}`);
  }
  streams.stdout('');

  let droppedTotal = 0;
  for (const target of report.targets) {
    streams.stdout(
      `${target.table}: lhůta ${target.window} (${target.setting}), ` +
        `hranice ${target.cutoff.toISOString()}`,
    );
    if (target.decisions.length === 0) {
      streams.stdout('  žádné oddíly');
    }
    for (const decision of target.decisions) {
      if (decision.drop) {
        droppedTotal += 1;
        // Sloveso v podmiňovacím tvaru jen nanečisto. Provozovatel musí z výpisu
        // poznat, jestli se to stalo, nebo teprve stane.
        streams.stdout(
          `  ${report.dryRun ? 'ZAHODILO BY SE' : 'zahozeno'}  ${decision.partition}  ${decision.bound}`,
        );
      } else {
        streams.stdout(`  ponecháno     ${decision.partition}  (${decision.keepReason})`);
      }
    }
    streams.stdout('');
  }

  streams.stdout(
    report.dryRun
      ? `Celkem by se zahodilo ${partitions(droppedTotal)}. Ostrý běh: mlain partitions`
      : `Celkem zahozeno: ${partitions(droppedTotal)}.`,
  );
}
