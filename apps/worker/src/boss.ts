import {
  QUEUE_REGISTRY,
  RETIRED_QUEUES,
  missingDependenciesOf,
  queueCreatePlan,
  retiredQueueDeleteOrder,
  type QueueHandler,
} from '@mlain/core/queues';

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
  /** Zruší plán cronu. Volá se u zrušených front a u front bez obsluhy, viz níž. */
  unschedule(name: string, key?: string): Promise<void>;
  /** Smaže frontu i s jejími úlohami. U neexistující fronty je to tichá prázdná operace. */
  deleteQueue(name: string): Promise<void>;
  work(name: string, options: Record<string, unknown>, handler: QueueHandler): Promise<string>;
  /** Veřejné API pg-bossu 12. Jediná cesta k politice existující fronty, viz níž. */
  getDb(): {
    executeSql(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
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
 * ÚKLID FRONT, KTERÉ SE ZRUŠILY, Z BĚŽÍCÍ DATABÁZE.
 *
 * Vyškrtnutí fronty z registru je změna kódu. Na čisté instalaci se fronta
 * nezaloží, ale na instalaci, která běží, řádek v `pgboss.queue` zůstane ležet
 * i s plánem v `pgboss.schedule` a s tiky v `pgboss.job`. Srovnávání politik
 * na něj schválně nesahá, protože chodí jen po frontách z registru.
 *
 * NENÍ TO KOSMETIKA. Naměřeno ve vývojové databázi 7. 8.: dvě zrušené fronty
 * měly pořád svůj denní cron a po čtyřech ticích ve stavu `created`. Zrušená
 * fronta tedy dál tikala do prázdna a v tabulce úloh přibývaly řádky, které si
 * nikdo nevyzvedne.
 *
 * MAZÁNÍ JE HLASITÉ, NE TICHÉ. Napřed se spočítá, co v té frontě leží, a teprve
 * pak se maže, protože `deleteQueue` nic nevrací. Bez toho by úklid vypadal
 * stejně, ať smaže prázdnou frontu nebo frontu s tisícem úloh, a to je přesně
 * ten rozdíl, který chce mít člověk v logu.
 *
 * SELHÁNÍ START WORKERU NESHODÍ, na rozdíl od srovnávání politik. Je to úklid
 * po sobě samém, ne podmínka správného chování: fronta, kterou se nepovedlo
 * smazat, dál nic nedělá, kdežto nesrovnaná politika tiše rozbije slučování.
 */
async function retireQueues(boss: BossLike, options: RegisterOptions): Promise<void> {
  if (RETIRED_QUEUES.length === 0) return;
  const names = retiredQueueDeleteOrder();

  let present: Record<string, unknown>[] = [];
  try {
    ({ rows: present } = await boss.getDb().executeSql(
      `SELECT q.name, count(j.id)::int AS jobs, count(s.name)::int AS schedules
         FROM "${options.schema}".queue AS q
         LEFT JOIN "${options.schema}".job AS j ON j.name = q.name
         LEFT JOIN "${options.schema}".schedule AS s ON s.name = q.name
        WHERE q.name = ANY($1::text[])
        GROUP BY q.name`,
      [names],
    ));
  } catch (error) {
    options.logger.warn(
      { err: (error as Error).message, queues: names },
      'nepodařilo se zjistit, jestli po zrušených frontách zůstaly řádky; úklid se přeskakuje',
    );
    return;
  }

  if (present.length === 0) {
    options.logger.info({ retired: RETIRED_QUEUES.length }, 'po zrušených frontách nic nezbylo');
    return;
  }

  const found = new Set(present.map((row) => String(row['name'])));
  const removed: string[] = [];
  // V pořadí z registru, tedy hlavní fronta před svou dead letter frontou:
  // `queue.dead_letter` i `job.dead_letter` mají ON DELETE RESTRICT.
  for (const name of names) {
    if (!found.has(name)) continue;
    try {
      // Napřed plán, teprve pak fronta. Cizí klíč sice `schedule` maže kaskádou,
      // ale plánovač pg-bossu si výčet drží i v paměti, takže by do smazané
      // fronty mohl stihnout tiknout mezi těmi dvěma kroky.
      await boss.unschedule(name);
      await boss.deleteQueue(name);
      removed.push(name);
    } catch (error) {
      options.logger.warn(
        { queue: name, err: (error as Error).message },
        'zrušenou frontu se nepodařilo odstranit; zůstává v databázi a příští start to zkusí znovu',
      );
    }
  }

  options.logger.warn(
    {
      removed,
      leftovers: present.map(
        (row) => `${row['name']}: ${row['jobs']} úloh, ${row['schedules']} plánů`,
      ),
    },
    'zrušené fronty odstraněny z databáze i s jejich tiky a plány cronu',
  );
}

/**
 * ÚKLID TIKŮ, KTERÉ SE V CRONOVÉ FRONTĚ BEZ OBSLUHY UŽ NAKUPILY.
 *
 * Zrušit plán (viz `registerQueues`) zastaví PŘÍRŮSTEK, ne to, co tam leží.
 * Naměřeno ve vývojové databázi 7. 8.: `domain.recheck` a `provider_event.rematch`
 * po 2 764 ticích ve stavu `created`, `deliverability.rollup`
 * a `provider.refresh_quota` po 186. Ani jeden z nich se nikdy nezpracuje,
 * protože obsluha neexistuje, a ani jeden nezmizí sám, protože expirace ani
 * archivace se stavu `created` netýkají.
 *
 * DVA DŮVODY, PROČ TO NENÍ JEN NEPOŘÁDEK. Za prvé hlídač cronových front bude
 * na těch šesti front hlásit zaseknutý tik při každém kole donekonečna, a hlášení,
 * které se nedá odstranit, se přestane číst. Za druhé by se po dodání obsluhy
 * spustilo najednou všechno nasbírané, tedy u kontroly domén tisíce skenů DNS naráz.
 *
 * PODMÍNKA JE ÚZKÁ SCHVÁLNĚ: `state = 'created'`, prázdný náklad a klíč NULL,
 * což je přesně to, co vkládá plánovač pg-bossu. Úloha od producenta má náklad
 * nebo klíč, takže se jí tenhle úklid nemůže dotknout ani omylem. Radši nechat
 * ležet tik, který sem patřil, než smazat práci, kterou někdo zařadil.
 */
async function purgeStuckCronTicks(
  boss: BossLike,
  queues: readonly string[],
  options: RegisterOptions,
): Promise<void> {
  if (queues.length === 0) return;
  try {
    const { rows } = await boss.getDb().executeSql(
      `DELETE FROM "${options.schema}".job
        WHERE name = ANY($1::text[])
          AND state = 'created'
          AND singleton_key IS NULL
          AND data = '{}'::jsonb
    RETURNING name`,
      [queues],
    );
    if (rows.length === 0) return;
    const perQueue = new Map<string, number>();
    for (const row of rows) {
      const name = String(row['name']);
      perQueue.set(name, (perQueue.get(name) ?? 0) + 1);
    }
    options.logger.warn(
      { removed: rows.length, queues: [...perQueue].map(([name, n]) => `${name}=${n}`) },
      'uvízlé tiky cronových front bez obsluhy smazány: nikdo by je nezpracoval a po dodání ' +
        'obsluhy by se spustily všechny najednou',
    );
  } catch (error) {
    options.logger.warn(
      { err: (error as Error).message, queues },
      'uvízlé tiky cronových front se nepodařilo smazat; zůstávají v tabulce úloh',
    );
  }
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

  // Předpis (co, s čím a v jakém pořadí) je v `queueCreatePlan`, protože ho
  // používá i testovací prostředí. Dřív si obě strany psaly vlastní cyklus
  // a rozešly se: testy zakládaly fronty BEZ politiky slučování, takže neměřily
  // totéž chování co provoz. Pořadí je v té funkci taky, i s důvodem.
  for (const { name, options: createOptions } of queueCreatePlan()) {
    await boss.createQueue(name, createOptions);
  }

  // AŽ TEĎ, ne dřív: fronta, která zrovna vznikla, už politiku z registru má,
  // a tenhle krok dorovná ty, které tu byly dřív. Opačné pořadí by nefungovalo,
  // protože srovnávat se dá jen existující řádek.
  await reconcilePolicies(boss, options);

  // Fronty, které se zrušily. Až po srovnání politik, protože ten krok o nich
  // nic neví, a před plánováním cronu, aby se zrušená fronta nestihla naplánovat.
  await retireQueues(boss, options);

  /*
   * CRON SE PLÁNUJE JEDINĚ FRONTĚ, KTERÁ MÁ OBSLUHU.
   *
   * Dřív se plánovaly všechny a u šesti front bez obsluhy to vyrábělo poruchu,
   * která se sama nespraví. Tik se zařadí do stavu `created`, nikdo si ho
   * nevyzvedne a NIKDY NEEXPIRUJE, protože expirace se týká běžících úloh.
   * Cronové fronty mají přitom politiku `exclusive`, takže od té chvíle
   * `job_common_i6` zahodí každý další tik: fronta je zamčená natrvalo. Worker
   * o chybějící obsluze řekl jednou při startu a pak mlčel.
   *
   * Naměřeno ve vývojové databázi 7. 8.: `domain.recheck` 2 764 tiků ve stavu
   * `created`, `provider_event.rematch` 2 764, `deliverability.rollup` 186,
   * `provider.refresh_quota` 186. Tolik řádků, které nikdo nikdy nezpracuje.
   *
   * A JE TO HORŠÍ NEŽ NEPOŘÁDEK. Kdyby obsluha přibyla později, spustí se
   * najednou všechno, co se za ty měsíce nasbíralo. U kontroly domén to znamená
   * tisíce skenů DNS naráz.
   *
   * `unschedule` je druhá polovina: plán, který v databázi UŽ JE, by samotné
   * přeskočení `schedule` nezrušilo, a tikalo by se dál. Až obsluha vznikne,
   * naplánuje se fronta zase sama, protože tahle podmínka platí oběma směry.
   *
   * NEZAPOJENÁ OBSLUHA (`needsDependencies`) SE POČÍTÁ JAKO ŽÁDNÁ, a je to
   * druhý nález, ne opsané pravidlo. Taková obsluha existuje proto, aby úloha
   * spadla NAHLAS a někdo si toho všiml. U fronty, kterou plní člověk, to
   * funguje: chyba je připnutá ke konkrétní akci. U cronové fronty se z toho
   * stane generátor selhání. Naměřeno ve vývojové databázi 7. 8.:
   * `outbox.reconcile` tiká každou minutu a nasbírala 3 993 selhaných úloh
   * se **stejnou hláškou** za čtyři dny, `ai.cleanup_conversations` čtyři.
   * Hlášení, které přijde tisíckrát denně a pokaždé stejné, není hlasitější
   * než ticho, jen dražší. Chybějící závislosti se proto říkají JEDNOU při
   * startu a fronta se nenaplánuje.
   *
   * Obsluha se přesto REGISTRUJE (`boss.work` níž), takže ruční zařazení
   * úlohy do té fronty pořád spadne nahlas. Potlačuje se jen tikání.
   */
  const cronWithoutHandler: string[] = [];
  const cronWithoutDeps: string[] = [];
  for (const entry of QUEUE_REGISTRY) {
    if (entry.cron === undefined) continue;
    const handler = handlers[entry.name];
    const unmetDependencies = handler ? missingDependenciesOf(handler) : undefined;
    if (handler && unmetDependencies === undefined) {
      await boss.schedule(entry.name, entry.cron, {}, { tz: 'UTC' });
      continue;
    }
    if (unmetDependencies === undefined) cronWithoutHandler.push(entry.name);
    else cronWithoutDeps.push(`${entry.name}: ${unmetDependencies}`);
    await boss.unschedule(entry.name);
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
  if (cronWithoutHandler.length > 0) {
    options.logger.warn(
      { queues: cronWithoutHandler, count: cronWithoutHandler.length },
      'cronové fronty bez obsluhy se NEPLÁNUJÍ a jejich plán se ruší: tik by uvízl ve stavu ' +
        'created, nikdy neexpiroval a politika exclusive by od té chvíle zahazovala každý další',
    );
    await purgeStuckCronTicks(boss, cronWithoutHandler, options);
  }
  if (cronWithoutDeps.length > 0) {
    options.logger.warn(
      { queues: cronWithoutDeps, count: cronWithoutDeps.length },
      'cronové fronty s nezapojenou obsluhou se NEPLÁNUJÍ: každý tik by skončil chybou ' +
        'a nasbíral tisíce stejných selhání. Chybějící závislosti jsou vypsané u každé fronty',
    );
  }
  options.logger.info(
    { queues: QUEUE_REGISTRY.length, with_handler: QUEUE_REGISTRY.length - missing.length },
    'registrace front hotová',
  );
}
