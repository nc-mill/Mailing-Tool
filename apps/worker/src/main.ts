import { PgBoss } from 'pg-boss';
import { loadConfig, missingConfigRequirements, ConfigError } from '@mlain/core/config';
import { createLogger } from '@mlain/core/logging';
import { createShutdownController } from '@mlain/core/shutdown';
import { aiKeyLeakCheck, type Check } from '@mlain/core/health';
import { installSystemMailer } from '@mlain/core/platform/system-mail-runtime';
import { installConsentEraser, installSubscriptionEmails } from '@mlain/core/contacts';
import { installRevokePendingMessages } from '@mlain/core/campaigns';
import { isolationCheck, warnIfIsolationBroken } from '@mlain/core/tx/isolation-guard';
import { registerQueues } from './boss';
import { startCronWatch } from './cron-watch';
import { startJobWatch } from './job-watch';
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
   * Kompoziční kořen rušení připravené pošty.
   *
   * Port `revokePendingMessages` si implementaci dohledá i sám, protože zapojení
   * jen odsud by pro obsluhu tras ve webu bylo neviditelné. Volá se tu přesto,
   * a to kvůli tomuhle řádku v logu: rušení pošty po odhlášení je právní
   * povinnost a musí být na startu vidět, že běží, ne se to dovozovat.
   */
  installRevokePendingMessages();
  logger.info({}, 'rušení připravené pošty po odhlášení je zapojené');

  /**
   * CHYBĚJÍCÍ KONFIGURACE SE ŘÍKÁ HNED PŘI STARTU, ne až u první úlohy.
   *
   * Dřív tu stály dvě ručně psané podmínky, pro `DATABASE_URL_MAINTENANCE`
   * a `DATABASE_URL_GDPR`, každá s vlastním výčtem postižených front. Byly
   * věcně správné a přesto nestačily, ze dvou důvodů:
   *
   *  1. Výčty zastarávaly. Ten u údržbového připojení jmenoval `outbox.reconcile`,
   *     přestože ta fronta údržbové připojení už nepotřebuje, a `domain.recheck`,
   *     která v téhle verzi nemá obsluhu vůbec. Seznam psaný ručně vedle kódu
   *     stárne tiše.
   *  2. Táž informace se nedostala nikam jinam. Řádek v logu si přečte ten, kdo
   *     log otevře v tu správnou minutu; instalační průvodce ani `mlain doctor`
   *     o tom nevěděly nic.
   *
   * Zdrojem pravdy je proto tabulka `CONFIG_REQUIREMENTS` v jádru, kterou čte
   * i obrazovka. Je to VAROVÁNÍ, ne brána: start se kvůli tomu neshodí, protože
   * instalace, které dosud běžely bez těch proměnných, se nemají rozbít změnou
   * verze. Rozhodnutí zadavatele z 8. 8. 2026.
   */
  for (const missing of missingConfigRequirements(config)) {
    logger.warn(
      { variable: missing.variable, modes: missing.modes },
      `chybí ${missing.variable}: ${missing.impact}`,
    );
  }

  /**
   * Izolace projektů. Ve workeru se na výsledek ČEKÁ, na rozdíl od webu:
   * worker v tuhle chvíli databázi stejně potřebuje (za dva řádky ji volá
   * `boss.start()`), takže jeden dotaz do katalogu navíc start nezdrží ani
   * nezkomplikuje. Hláška navíc musí být v logu dřív, než začnou chodit
   * záznamy úloh, jinak se v nich ztratí.
   */
  await warnIfIsolationBroken(logger);

  await boss.start();
  await registerQueues(boss as never, HANDLERS, {
    concurrency: config.WORKER_CONCURRENCY,
    schema: config.PGBOSS_SCHEMA,
    logger,
  });

  /**
   * Hlídač zahazovaných tiků. Podrobné zdůvodnění, proč to nedělá
   * `warningQueueSize`, je v hlavičce `cron-watch.ts`; ve zkratce: ta mez měří
   * NAROSTLOU frontu a u politiky `exclusive` nemůže `queued_count` přelézt
   * jedničku, takže by se nikdy neprojevila.
   */
  const stopCronWatch = startCronWatch({
    db: boss.getDb(),
    schema: config.PGBOSS_SCHEMA,
    logger,
  });

  /**
   * Hlídač úloh, které tvrdí „běží", a ve frontě k nim nic není. Je to JINÁ
   * porucha než obě, které hlídá `cron-watch`, a chytá ji zvenčí: porovnává
   * doménové tabulky s obsahem fronty. Podrobnosti i přiznané slepé místo
   * jsou v hlavičce `job-watch.ts`.
   *
   * Bez `DATABASE_URL_MAINTENANCE` sken napříč projekty vyhodí výjimku
   * a hlídač ji nahlásí JEDNOU jako varování. Je to správný konec: bez té
   * proměnné stejně neběží ani kampaně, na což upozorňuje řádek výš.
   */
  const stopJobWatch = startJobWatch({
    db: boss.getDb(),
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
    checks: [workerReady, aiKeyLeakCheck(), isolationCheck()],
  });
  logger.info({ port: config.WORKER_HEALTH_PORT }, 'worker naslouchá na health portu');

  const shutdown = createShutdownController({
    graceSeconds: config.SHUTDOWN_GRACE_SECONDS,
    logger,
  });
  shutdown.register('cron-watch', async () => {
    stopCronWatch();
  });
  shutdown.register('job-watch', async () => {
    stopJobWatch();
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
