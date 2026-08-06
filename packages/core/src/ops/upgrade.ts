import { sql } from 'drizzle-orm';
import { runBackup } from './backup';
import { applyGrants } from './backup-verify';
import { withAdminTx } from './db';

/** Jména procesů, která se nastavují jako application_name podle konvence P01. */
const BLOCKING_APPLICATIONS = ['mlain-worker', 'mlain-sender'] as const;

export class ProcessesStillRunningError extends Error {
  constructor(apps: readonly string[]) {
    super(
      `Upgrade se nespustí, protože k databázi jsou pořád připojené: ${apps.join(', ')}. ` +
        'Zastavte je příkazem "docker compose stop worker sender" (při MODE=all celý kontejner ' +
        'příkazem "docker compose stop app") a spusťte mlain upgrade znovu. ' +
        'Migrace pod běžícím senderem znamená, že sender čte schéma, které se pod ním mění.',
    );
    this.name = 'ProcessesStillRunningError';
  }
}

export type UpgradeInput = {
  /** Aplikační URL. Používá se jen k tomu, aby šlo do reportu vypsat, kam míří. */
  appUrl: string;
  adminUrl: string;
  backupDir: string;
  uploadsDir: string;
  dataDir: string;
  appVersion: string;
  secretKeyFingerprint: string;
  readinessUrl: string;
  now: Date;
  skipReadiness?: boolean;
};

export type UpgradeReport = {
  steps: string[];
  backupDir: string;
  readinessOk: boolean;
  nextSteps: string;
};

/**
 * Procesy se nezastavují ani nespouštějí. Zvenčí kontejneru by to vyžadovalo
 * docker socket uvnitř kontejneru, což je root na hostiteli a zahodilo by to
 * celý bezpečnostní model (read-only rootfs, uživatel 10001). Příkaz proto
 * ověří, že procesy neběží, udělá zálohu, zmigruje, ověří readiness a vypíše
 * přesné příkazy na návrat. Odchylka od 3.14 je vědomá.
 */
export async function runUpgrade(input: UpgradeInput): Promise<UpgradeReport> {
  const steps: string[] = [];

  const running = await withAdminTx(input.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ application_name: string }>(
      sql`SELECT DISTINCT application_name
            FROM pg_stat_activity
           WHERE application_name = ANY(${sql.param([...BLOCKING_APPLICATIONS])})
             AND pid <> pg_backend_pid()`,
    );
    return rows.map((r) => r.application_name);
  });
  if (running.length > 0) throw new ProcessesStillRunningError(running);
  steps.push('preflight');

  const backup = await runBackup({
    databaseUrl: input.adminUrl,
    backupDir: input.backupDir,
    uploadsDir: input.uploadsDir,
    appVersion: input.appVersion,
    secretKeyFingerprint: input.secretKeyFingerprint,
    now: input.now,
    postBackupHook: `${input.dataDir}/hooks/post-backup.sh`,
  });
  steps.push('backup');

  // `runMigrations` vrací `void`, ne seznam aplikovaných migrací; počet se
  // z něj přečíst nedá a upgrade ho nepotřebuje. Kdo ho chce vidět, čte
  // `schema_version` v system_settings před a po.
  // Migrační runner se načítá dynamicky, ne statickým importem. Runner si
  // skládá cestu k migracím přes `new URL('../migrations', import.meta.url)`,
  // což bundler Next.js neumí přeložit; jakmile se modul dostane do grafu
  // aplikace (a přes barrel `@mlain/core/ops` se tam dostane), spadne KAŽDÁ
  // stránka, ne jen zálohy. Totéž řeší `backup-verify.ts`.
  //
  // `migrationsFolder` je povinný a skládá ho `resolveMigrationsFolder()`,
  // jediné místo v repozitáři, které tu cestu odvozuje. Runner si ji sám
  // odvodit neumí: v zabundlovaném CLI míří `import.meta.url` do
  // `/app/apps/cli/dist/`, kdežto migrace leží v `/app/packages/db/migrations`.
  const { resolveMigrationsFolder, runMigrations } = await import('@mlain/db/migrate');
  await runMigrations({ url: input.adminUrl, migrationsFolder: resolveMigrationsFolder() });
  steps.push('migrate');

  // Granty po migraci. Při běžném upgradu jsou už na místě a funkce je
  // idempotentní, takže neudělá nic. Rozdíl je v případě, kdy se upgraduje
  // instalace obnovená ze zálohy starším postupem: tam granty chybí a bez
  // tohohle volání by aplikace po restartu nenaběhla.
  await applyGrants(input.adminUrl);
  steps.push('grants');

  let readinessOk = false;
  if (input.skipReadiness !== true) {
    const response = await fetch(input.readinessUrl).catch(() => null);
    readinessOk = response?.ok === true;
    steps.push('readiness');
  }

  return {
    steps,
    backupDir: backup.dir,
    readinessOk,
    nextSteps: [
      'Upgrade databáze je hotový. Procesy zpět nastartujete takhle:',
      '',
      '  docker compose up -d',
      '',
      'Potom ověřte, že /api/health/ready vrací 200, a spusťte mlain doctor.',
    ].join('\n'),
  };
}
