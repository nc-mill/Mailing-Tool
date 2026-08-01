import { PgBoss } from 'pg-boss';
import { loadConfig, ConfigError } from '@mlain/core/config';
import { createLogger } from '@mlain/core/logging';
import { createShutdownController } from '@mlain/core/shutdown';
import { aiKeyLeakCheck, type Check } from '@mlain/core/health';
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
  });
  boss.on('error', (error) => logger.error({ err: error.message }, 'pg-boss ohlásil chybu'));
  boss.on('warning', (warning) => logger.warn({ warning }, 'pg-boss varuje'));

  // Jediný spolehlivý signál, že pg-boss skončil. Bez něj by readiness po
  // zastavení bosse dál hlásil ok, dokud by neselhal dotaz do databáze.
  let bossStopped = false;
  boss.on('stopped', () => {
    bossStopped = true;
  });

  await boss.start();
  await registerQueues(boss as never, HANDLERS, {
    concurrency: config.WORKER_CONCURRENCY,
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
