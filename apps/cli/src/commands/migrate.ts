import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes';
import type { CliStreams } from '../dispatch';

/**
 * Kde leží migrace, počítáno vůči SESTAVENÉMU CLI, ne vůči `packages/db`.
 *
 * `packages/db/src/migrate.ts` si výchozí cestu skládá jako
 * `new URL('../migrations', import.meta.url)`. To platí, dokud modul běží ze
 * svého místa ve stromu. CLI se ale bundluje esbuildem do jediného souboru
 * `apps/cli/dist/main.js`, takže se `import.meta.url` vztahuje k NĚMU a výchozí
 * cesta vyjde na `apps/cli/migrations`, kde nic není. Stejně mimo je i v image:
 * Dockerfile kopíruje migrace do `/app/packages/db/migrations`.
 *
 * Z `apps/cli/dist/main.js` vede ke kořeni `../../..`, což sedí lokálně
 * i v kontejneru, protože image drží tentýž tvar stromu.
 *
 * `MIGRATIONS_DIR` je únikový východ pro nestandardní rozložení. Běžně se
 * nenastavuje.
 */
function resolveMigrationsFolder(env: NodeJS.ProcessEnv): string {
  const override = env['MIGRATIONS_DIR'];
  if (override !== undefined && override !== '') return override;
  return fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));
}

/**
 * `mlain migrate` aplikuje migrace pod rolí `mlain_migrator`.
 *
 * Volá ho `docker/entrypoint.sh` při startu kontejneru, když je
 * `MIGRATE_ON_START=true` (výchozí stav). Do té doby vracel registr exit 69
 * (EX_UNAVAILABLE, „příkaz je deklarovaný, ale nikdo nedodal jeho tělo"),
 * což entrypoint SCHVÁLNĚ toleroval, aby šla image postavit před dodáním P03.
 *
 * Ta tolerance ale znamenala, že kontejner nastartoval s PRÁZDNÝM schématem
 * a tvářil se zdravě. Naměřeno při stavbě zlaté cesty: readiness vrátila 200,
 * protože se kontrola schématu sama přeskočila, a vzápětí padal worker na
 * „permission denied for database mlain", protože pg-boss neměl kde založit
 * své schéma. Prohlížeč pak na `/setup` dostal odmítnuté spojení.
 *
 * Připojuje se přes `DATABASE_URL_MIGRATOR`, ne přes `DATABASE_URL`:
 * `DATABASE_URL` je role `mlain_app`, která schéma nevlastní a migrovat nesmí.
 *
 * Runner drží advisory lock, takže při víc replikách migruje jen jedna
 * a ostatní počkají. Přetečení čekání je exit 75 (EX_TEMPFAIL), po kterém
 * kontejner restartuje a zkusí to znovu.
 */
export async function runMigrateCommand(
  streams: CliStreams,
  _args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  let migratorUrl: string;
  try {
    const configured = loadConfig(env).DATABASE_URL_MIGRATOR;
    if (configured === undefined || configured === '') {
      // Bez migrátora se migrovat NEDÁ a nemá smysl to zkoušet: `DATABASE_URL`
      // je role `mlain_app`, která schéma nevlastní. Pokus by skončil na
      // „permission denied", což je matoucí hláška pro to, co je ve
      // skutečnosti chybějící konfigurace.
      streams.stderr(
        'DATABASE_URL_MIGRATOR: je povinná pro migrace a chybí. Role z DATABASE_URL ' +
          '(mlain_app) schéma nevlastní a měnit ho nesmí.',
      );
      return EXIT_CONFIG;
    }
    migratorUrl = configured;
  } catch (error) {
    if (error instanceof ConfigError) {
      for (const issue of error.issues) {
        streams.stderr(`${issue.variable}: ${issue.message}`);
      }
      return EXIT_CONFIG;
    }
    throw error;
  }

  // Runner se načítá dynamicky, aby se `packages/db/src/migrate.ts` nedostal
  // do statického grafu modulů. Skládá si cestu k adresáři s migracemi
  // a bundler ji neumí přeložit; dvakrát to shodilo celou aplikaci na 500.
  const { MigrationError, runMigrations } = await import('@mlain/db/migrate');

  try {
    await runMigrations({
      url: migratorUrl,
      migrationsFolder: resolveMigrationsFolder(env),
      logger: (message: string) => streams.stdout(message),
    });
    await bootstrapQueueSchema(streams, migratorUrl, env);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof MigrationError) {
      // Runner rozlišuje důvod selhání vlastním exit kódem: 3 selhaná migrace,
      // 4 přeskočená major verze, 5 schema_version_ahead, 75 timeout zámku.
      // Entrypoint podle nich rozhoduje, jestli má kontejner restartovat.
      streams.stderr(error.message);
      return error.exitCode;
    }
    throw error;
  }
}

/**
 * Schéma fronty úloh, které si jinak zakládá worker sám a nesmí.
 *
 * `PgBoss.start()` volá `Contractor.create()`, a ten pouští
 * `CREATE SCHEMA IF NOT EXISTS`. Worker přitom běží pod `DATABASE_URL`, tedy
 * jako `mlain_app`, která nemá `CREATE` na databázi:
 *
 *   error: permission denied for database mlain   (SQLSTATE 42501)
 *     at Contractor.create ... PgBoss.start ... main
 *     file: 'aclchk.c', routine: 'aclcheck_error'
 *
 * `IF NOT EXISTS` to NEODVRÁTÍ, i když schéma už existuje: Postgres kontroluje
 * oprávnění dřív než existenci, což je vidět na tom, že chyba přichází
 * z `aclchk.c`, tedy z kontroly práv. Založit schéma migrací proto samo o sobě
 * nestačilo, ověřeno.
 *
 * Řešení drží pravidlo, že schéma vlastní jedině migrátor: pg-boss si své
 * schéma postaví a zmigruje TADY, pod rolí migrátora, a worker ho pak jen
 * používá s `migrate: false`. Používá se k tomu vlastní logika knihovny, ne
 * vygenerované SQL vlepené do migrace, a to schválně: tvar těch tabulek patří
 * knihovně a s její verzí se mění. `getConstructionPlans()` navíc idempotentní
 * NENÍ, druhý běh padne na „type job_state already exists", kdežto `start()`
 * si existující instalaci pozná a jen dopočítá, co chybí.
 *
 * Aplikační role pak potřebuje práva na hotové tabulky. Tabulky vlastní
 * migrátor, takže se přidělují tady, ne v migraci: v době jejího běhu ještě
 * neexistují.
 */
async function bootstrapQueueSchema(
  streams: CliStreams,
  migratorUrl: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const schema = env['PGBOSS_SCHEMA'] ?? 'pgboss';
  const { PgBoss } = await import('pg-boss');

  const boss = new PgBoss({ connectionString: migratorUrl, schema, supervise: false, max: 2 });
  try {
    await boss.start();
    streams.stdout(`schéma fronty ${schema} je připravené`);
  } finally {
    await boss.stop({ graceful: false }).catch(() => undefined);
  }

  // Práva pro aplikační a odesílací roli. `IF EXISTS` tu není, protože v týhle
  // chvíli tabulky existovat MUSÍ; kdyby ne, je něco špatně a chceme to vidět.
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO mlain_app`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO mlain_app`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO mlain_app`);
    // Pro tabulky, které pg-boss založí později (partition per fronta).
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} ` +
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mlain_app`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
