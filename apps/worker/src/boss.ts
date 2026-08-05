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
  /**
   * Schéma pg-bossu, tedy `PGBOSS_SCHEMA`. Potřebné jedině pro srovnání politik
   * u front, které v databázi UŽ EXISTUJÍ; viz `reconcilePolicies`.
   */
  readonly schema: string;
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
  /** Veřejné API pg-bossu 12. Jediná cesta k politice existující fronty, viz níž. */
  getDb(): {
    executeSql(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
}

function queueOptions(entry: QueueEntry): Record<string, unknown> {
  return {
    // Konvence 9.1: explicitně, nikdy se nespoléhat na výchozí hodnoty.
    retryLimit: entry.retryLimit,
    retryBackoff: entry.retryBackoff,
    retryDelay: entry.retryDelaySeconds,
    expireInSeconds: entry.expireInSeconds,
    // Slučování duplicitních úloh. Bez tohohle řádku uloží pg-boss `singletonKey`
    // do sloupce a NIC podle něj neslučuje, protože pro politiku `standard` ho
    // ignoruje. Přesně v tom stavu byl produkt: 47 front klíč deklarovalo,
    // producenti ho posílali, a nesloučila se ani jedna úloha.
    //
    // Fronta bez `policy` v registru zůstává `standard` schválně, důvod je
    // u každé takové v jejím `discardNote`.
    ...(entry.policy ? { policy: entry.policy } : {}),
    ...(entry.deadLetter ? { deadLetter: dlqName(entry.name) } : {}),
  };
}

/**
 * Srovnání politik u front, které v databázi UŽ JSOU.
 *
 * PROČ TO TU MUSÍ BÝT. `createQueue()` končí v SQL funkci `pgboss.create_queue`,
 * a ta má `ON CONFLICT DO NOTHING`. Existující frontu tedy nechá přesně tak, jak
 * je, a nová politika by se projevila jedině na ČISTÉ INSTALACI. Na instalaci,
 * která běží, by změna registru nezměnila vůbec nic a vypadala by hotově.
 *
 * PROČ NE `updateQueue()`. Nabízí se, ale politiku změnit neumí a řekne to
 * nahlas: `manager.js` má `if ('policy' in options) throw new Error('queue
 * policy cannot be changed after creation')` a typ `UpdateQueueOptions` je
 * `Omit<Queue, 'name' | 'partition' | 'policy'>`. Zbývá tedy přímý zápis do
 * `pgboss.queue`, na který role `mlain_app` právo má.
 *
 * PROČ TO NEPOTŘEBUJE ŽÁDNÉ DDL. Slučování nedělá sloupec `queue.policy`, dělají
 * ho částečné unikátní indexy nad tabulkou úloh (`job_common_i1` až `i6`), které
 * se řídí sloupcem `policy` NA ŘÁDKU ÚLOHY; ten se z fronty kopíruje při vložení.
 * Naše fronty nejsou `partition: true`, takže všechny úlohy leží ve sdílené
 * `job_common`, a ta má všechny ty indexy založené od začátku. Přepnutí politiky
 * je proto jediný UPDATE, ne migrace.
 *
 * Běží při KAŽDÉM startu, ne jednorázově migrací: registr se bude měnit dál
 * a jednorázová migrace by pokryla jen ten jeden krok.
 *
 * Sahá VÝHRADNĚ na fronty z registru. Interní `__pgboss__send-it` ani fronty,
 * které z registru vypadly (`retention.drop_message_partitions`,
 * `tracking.enforce_retention`), se nesmí dotknout: první patří knihovně
 * a u druhých by změna politiky byla zásah do něčeho, co už nikdo neřídí.
 * Dead letter fronty tu taky nejsou a být nesmí; slučovat nedoručitelné úlohy
 * by znamenalo tiše zahazovat právě to, co se má vyšetřit.
 */
async function reconcilePolicies(boss: BossLike, options: RegisterOptions): Promise<void> {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(options.schema)) {
    throw new Error(
      `Schéma pg-bossu "${options.schema}" není platný identifikátor. Název se do dotazu ` +
        'vkládá textově, protože jím parametrizovat nejde, takže se kontroluje předem.',
    );
  }

  const names = QUEUE_REGISTRY.map((entry) => entry.name);
  // Fronta bez politiky v registru má být `standard`, tedy i zpátky: kdyby někdo
  // politiku z registru odebral, musí se srovnat i tímhle směrem, jinak by
  // v databázi zůstala zapnutá a registr by lhal.
  const policies = QUEUE_REGISTRY.map((entry) => entry.policy ?? 'standard');

  /**
   * SELHÁNÍ TOHOHLE KROKU MUSÍ SHODIT START WORKERU, ne se jen zalogovat.
   *
   * Když se srovnání nepovede, běží worker nad frontami, jejichž politika je
   * neznámá: nejspíš `standard`, tedy bez slučování. To je přesně ten stav,
   * kvůli kterému tenhle kód vznikl, a tiché pokračování by ho vyrobilo znovu,
   * jen o patro výš. Zalogovaná chyba by se ztratila mezi ostatními a produkt
   * by zase rok vypadal, že slučuje.
   *
   * Je to totéž rozhodnutí, jaké dělá `migrate: false` v `main.ts`: worker radši
   * nenaběhne, než aby jel nad schématem, o kterém neví, jak vypadá.
   */
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await boss.getDb().executeSql(
      `UPDATE "${options.schema}".queue AS q
          SET policy = w.policy
         FROM unnest($1::text[], $2::text[]) AS w(name, policy)
        WHERE q.name = w.name
          AND q.policy IS DISTINCT FROM w.policy
    RETURNING q.name, q.policy`,
      [names, policies],
    ));
  } catch (error) {
    throw new Error(
      'Nepodařilo se srovnat politiku slučování u front, které v databázi už existují, ' +
        `a worker proto nenaběhne. Bez tohohle kroku by běžel nad frontami s politikou ` +
        '`standard`, u kterých pg-boss `singletonKey` IGNORUJE, takže by se duplicitní ' +
        'úlohy tiše přestaly slučovat a nic by to neřeklo. Nejpravděpodobnější příčina je ' +
        `chybějící právo UPDATE na "${options.schema}".queue pro roli z DATABASE_URL. ` +
        `Původní chyba: ${(error as Error).message}`,
      { cause: error },
    );
  }

  if (rows.length === 0) {
    options.logger.info({ queues: names.length }, 'politiky front souhlasí s registrem');
    return;
  }
  options.logger.warn(
    { changed: rows.length, queues: rows.map((row) => `${row['name']}=${row['policy']}`) },
    'politika slučování se u existujících front srovnala podle registru',
  );
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

  // AŽ TEĎ, ne dřív: fronta, která zrovna vznikla, už politiku z registru má,
  // a tenhle krok dorovná ty, které tu byly dřív. Opačné pořadí by nefungovalo,
  // protože srovnávat se dá jen existující řádek.
  await reconcilePolicies(boss, options);

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
