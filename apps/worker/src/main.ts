import { PgBoss } from 'pg-boss';
import { loadConfig, ConfigError } from '@mlain/core/config';
import { createLogger } from '@mlain/core/logging';
import { createShutdownController } from '@mlain/core/shutdown';
import { aiKeyLeakCheck, type Check } from '@mlain/core/health';
import { installSystemMailer } from '@mlain/core/platform/system-mail-runtime';
import { installConsentEraser, installSubscriptionEmails } from '@mlain/core/contacts';
import { gdprConfigured, maintenanceConfigured } from '@mlain/core/tx/index';
import { registerQueues } from './boss';
import { startHealthServer } from './health-server';
import { HANDLERS } from './handlers.generated';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.format()}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
    mode: 'worker',
    version: config.IMAGE_VERSION,
  });

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.PGBOSS_SCHEMA,
    max: config.DATABASE_POOL_MAX,
    // Worker schéma fronty NEZAKLÁDÁ ani nemigruje. Dělá to `mlain migrate`
    // pod rolí migrátora, aby platilo, že schéma vlastní jedině migrátor.
    //
    // Není to jen čistota. Worker běží pod `DATABASE_URL`, tedy jako
    // `mlain_app`, a ta nemá `CREATE` na databázi. `PgBoss.start()` volá
    // `Contractor.create()` s `CREATE SCHEMA IF NOT EXISTS`, takže padal na
    //
    //   error: permission denied for database mlain   (SQLSTATE 42501)
    //     file: 'aclchk.c', routine: 'aclcheck_error'
    //
    // a kontejner skončil v restartové smyčce. `IF NOT EXISTS` to neodvrátí:
    // Postgres kontroluje oprávnění dřív než existenci, takže samotné
    // předchozí založení schématu migrací nestačilo. Ověřeno.
    //
    // S `false` knihovna schéma jen ZKONTROLUJE. Když chybí nebo má jinou
    // verzi, řekne to nahlas, což je správně: znamená to, že se zapomnělo
    // migrovat, a tichý start nad polovičním schématem by byl horší.
    migrate: false,
  });
  boss.on('error', (error) => logger.error({ err: error.message }, 'pg-boss ohlásil chybu'));
  boss.on('warning', (warning) => logger.warn({ warning }, 'pg-boss varuje'));

  // Jediný spolehlivý signál, že pg-boss skončil. Bez něj by readiness po
  // zastavení bosse dál hlásil ok, dokud by neselhal dotaz do databáze.
  let bossStopped = false;
  boss.on('stopped', () => {
    bossStopped = true;
  });

  /**
   * Kompoziční kořen systémové pošty. Ve workeru je potřeba stejně jako ve webu:
   * upozornění na vypnutý webhook posílá `platform.webhook_deliver`, tedy job,
   * který běží tady. Zapojení jen ve webu by znamenalo, že část systémové pošty
   * chodí a část mizí, a to se hledá hůř než když nechodí nic.
   */
  installSystemMailer();
  logger.info({}, 'systémová pošta je zapojená');

  /**
   * Kompoziční kořen e-mailů seznamu. Ve workeru je potřeba stejně jako ve webu:
   * přihlášení vzniká i z úloh (import, zpracování příchozí pošty), a bez zapojení
   * by z nich potvrzovací e-mail tiše nikam neodešel. Zapojení jen ve webu by
   * znamenalo, že část potvrzení chodí a část mizí, a to se hledá hůř než když
   * nechodí nic.
   */
  installSubscriptionEmails();
  logger.info({}, 'e-maily seznamu jsou zapojené');

  /**
   * Kompoziční kořen výmazu podle článku 17.
   *
   * Souhlasy smí smazat jedině role `mlain_gdpr` a do téhle chvíle ji
   * registrovaly POUZE testy, takže úloha `gdpr.erase` v režimu `anonymize`,
   * tedy ve výchozím režimu, selhala pokaždé. Zapojení patří sem, protože
   * anonymizaci volá jen worker: úloha `gdpr.erase` a retenční cíl
   * `inactive_contacts`. Web ji nevolá vůbec.
   */
  installConsentEraser();
  logger.info({}, 'mazač souhlasů pod rolí mlain_gdpr je zapojený');

  /**
   * Hlasité upozornění na chybějící `DATABASE_URL_MAINTENANCE`.
   *
   * Proměnná je volitelná, takže instalace bez ní naběhne a běžný provoz
   * funguje. Bez ní ale nemají systémové skeny čím číst napříč projekty a
   * NAPLÁNOVANÁ KAMPAŇ SE NEODESLE. Řeklo by to i každé jednotlivé selhání
   * úlohy, jenže do fronty se nikdo nedívá; tenhle řádek je na začátku logu,
   * kam se dívá každý.
   */
  if (!maintenanceConfigured()) {
    logger.warn(
      {
        variable: 'DATABASE_URL_MAINTENANCE',
        jobs: [
          'campaign.scheduler',
          'campaign.watchdog',
          'campaign.resume_on_quota',
          'outbox.reconcile',
          'domain.recheck',
          'platform.purge_workspaces',
        ],
      },
      'chybí připojení pod rolí mlain_maintenance: úlohy, které čtou napříč projekty, ' +
        'poběží do chyby. Naplánovaná kampaň se neodešle a smazané projekty se neuklidí.',
    );
  }

  /**
   * Totéž pro `DATABASE_URL_GDPR`, a je to o stupeň horší případ: bez téhle
   * proměnné nedoběhne VÝMAZ OSOBNÍCH ÚDAJŮ podle článku 17, tedy zákonná
   * povinnost se lhůtou. Úloha skončí v chybě, žádost subjektu zůstane ve
   * stavu `verified` a nic po sobě nenechá; hlášku proto worker říká hned
   * při startu, ne až u první žádosti.
   */
  if (!gdprConfigured()) {
    logger.warn(
      {
        variable: 'DATABASE_URL_GDPR',
        jobs: ['gdpr.erase', 'retention.run'],
      },
      'chybí připojení pod rolí mlain_gdpr: souhlasy nemá kdo smazat, takže výmaz podle ' +
        'článku 17 v režimu anonymize se ZRUŠÍ CELÝ. Týká se i retenčního cíle inactive_contacts.',
    );
  }

  await boss.start();
  await registerQueues(boss as never, HANDLERS, {
    concurrency: config.WORKER_CONCURRENCY,
    schema: config.PGBOSS_SCHEMA,
    logger,
  });

  /**
   * Readiness workeru.
   *
   * NEPOUŽÍVÁ se událost `maintenance`: pg-boss 12 ji nemá. Jeho úplný výčet
   * událostí je `error`, `warning`, `wip`, `stopped`, `bam` a `flow`, ověřeno
   * spuštěním nad exportem `events`. Přihlášení k neexistující události nic
   * nevyhodí, jen se nikdy nezavolá, takže by časová značka zůstala na hodnotě
   * ze startu a po pěti minutách by readiness selhával navždy.
   *
   * Místo časové značky se dělá skutečný dotaz do databáze přes pool, který
   * pg-boss sám drží: `isInstalled()` ověří, že schéma pgboss existuje a že je
   * spojení živé. Je to jediná kontrola, která spadne i tehdy, když databáze
   * zmizí pod běžícím procesem.
   */
  const workerReady: Check = async () => {
    if (bossStopped) {
      return { name: 'pgboss', status: 'fail', detail: 'pg-boss se zastavil' };
    }
    try {
      const installed = await boss.isInstalled();
      if (!installed) {
        return { name: 'pgboss', status: 'fail', detail: 'schéma pgboss v databázi neexistuje' };
      }
      return { name: 'pgboss', status: 'ok' };
    } catch (error) {
      return { name: 'pgboss', status: 'fail', detail: (error as Error).message };
    }
  };

  const server = startHealthServer({
    port: config.WORKER_HEALTH_PORT,
    checks: [workerReady, aiKeyLeakCheck()],
  });
  logger.info({ port: config.WORKER_HEALTH_PORT }, 'worker naslouchá na health portu');

  const shutdown = createShutdownController({
    graceSeconds: config.SHUTDOWN_GRACE_SECONDS,
    logger,
  });
  shutdown.register('health-server', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  shutdown.register('pg-boss', async () => {
    await boss.stop({ graceful: true, timeout: config.SHUTDOWN_GRACE_SECONDS * 1000 });
  });
  shutdown.listen();
}

await main();
