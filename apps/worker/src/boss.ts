import { QUEUE_REGISTRY, dlqName, type QueueEntry, type QueueHandler } from '@mlain/core/queues';

/**
 * Události, ke kterým se worker přihlašuje. Jediný autoritativní seznam,
 * který pg-boss 12 vydává, je jeho vlastní export `events`; tenhle výčet
 * proti němu porovnává test, aby se nemohl objevit název, který knihovna nezná.
 *
 * Historie: dřívější znění workeru poslouchalo událost `maintenance`, kterou
 * pg-boss 12 nemá. Selhání bylo tiché a projevilo se až za provozu: readiness
 * čekal na tik údržby, ten nikdy nepřišel, a po pěti minutách začal worker
 * trvale hlásit 503, takže ho orchestrátor označil za nezdravý.
 */
export const BOSS_EVENTS = ['error', 'warning', 'stopped'] as const;

export interface RegisterOptions {
  readonly concurrency: number;
  readonly logger: {
    info(object: Record<string, unknown>, message?: string): void;
    warn(object: Record<string, unknown>, message?: string): void;
    error(object: Record<string, unknown>, message?: string): void;
  };
}

/** Minimální podmnožina pg-boss, kterou worker používá. Umožňuje test bez databáze. */
export interface BossLike {
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  schedule(name: string, cron: string, data?: unknown, options?: unknown): Promise<void>;
  work(name: string, options: Record<string, unknown>, handler: QueueHandler): Promise<string>;
}

function queueOptions(entry: QueueEntry): Record<string, unknown> {
  return {
    // Konvence 9.1: explicitně, nikdy se nespoléhat na výchozí hodnoty.
    retryLimit: entry.retryLimit,
    retryBackoff: entry.retryBackoff,
    retryDelay: entry.retryDelaySeconds,
    expireInSeconds: entry.expireInSeconds,
    ...(entry.deadLetter ? { deadLetter: dlqName(entry.name) } : {}),
  };
}

/**
 * Založí všechny fronty z registru, naplánuje ty s cronem a napojí handlery,
 * které v tomhle buildu existují. Fronta bez handleru se přesto zakládá:
 * kdyby ne, doménový plán by při prvním `boss.send` dostal chybu o neexistující
 * frontě a nepoznal by, že jde jen o nedodaný handler.
 */
export async function registerQueues(
  boss: BossLike,
  handlers: Record<string, QueueHandler>,
  options: RegisterOptions,
): Promise<void> {
  const missing: string[] = [];

  // POŘADÍ JE PODSTATNÉ: napřed fronta pro nedoručitelné, teprve pak ta, která
  // na ni odkazuje. `queueOptions` posílá `deadLetter: <jméno>.dlq` a pg-boss
  // trvá na tom, aby cílová fronta v té chvíli existovala:
  //
  //   Error: Queue platform.webhook_fanout.dlq does not exist
  //
  // Dokud si pg-boss migroval schéma sám, zakládal si chybějící fronty mimoděk
  // při prvním `send`, takže obrácené pořadí nevadilo. Od chvíle, kdy schéma
  // vlastní migrátor a worker jede s `migrate: false`, je `createQueue()`
  // jediná cesta a pořadí najednou rozhoduje. Kontejner na tom skončil
  // v restartové smyčce s jedinou frontou v databázi, a to ještě interní.
  for (const entry of QUEUE_REGISTRY) {
    if (entry.deadLetter) {
      await boss.createQueue(dlqName(entry.name), {
        retryLimit: 0,
        retryBackoff: false,
        retryDelay: 0,
        expireInSeconds: entry.expireInSeconds,
      });
    }
    await boss.createQueue(entry.name, queueOptions(entry));
  }

  for (const entry of QUEUE_REGISTRY) {
    if (entry.cron === undefined) continue;
    await boss.schedule(entry.name, entry.cron, {}, { tz: 'UTC' });
  }

  for (const entry of QUEUE_REGISTRY) {
    const handler = handlers[entry.name];
    if (!handler) {
      missing.push(entry.name);
      continue;
    }
    await boss.work(
      entry.name,
      { batchSize: 1, pollingIntervalSeconds: 2, ...(entry.concurrency ? {} : {}) },
      handler,
    );
  }

  if (missing.length > 0) {
    options.logger.warn(
      { queues: missing, count: missing.length },
      'fronty bez handleru v tomhle buildu; dodá je příslušný doménový plán',
    );
  }
  options.logger.info(
    { queues: QUEUE_REGISTRY.length, with_handler: QUEUE_REGISTRY.length - missing.length },
    'registrace front hotová',
  );
}
