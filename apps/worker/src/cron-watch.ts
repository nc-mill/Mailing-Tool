import { cronPeriodSeconds, cronQueues } from '@mlain/core/queues';

/**
 * HLÍDAČ ZAHAZOVANÝCH TIKŮ Z CRONU.
 *
 * PROČ NESTAČÍ `warningQueueSize`, ačkoli se nabízí jako první. pg-boss ji používá
 * na JEDINOU věc, a to na hlášení NAROSTLÉ FRONTY: v `boss.js` porovnává
 * `Number(i.queuedCount) > (Number(i.warningQueueSize) || 10000)` a teprve pak
 * vydá událost `queue_backlog`. Jenže cronové fronty mají v registru politiku
 * `exclusive`, a ta znamená, že v nedokončených stavech existuje NEJVÝŠ JEDNA
 * úloha: druhá narazí na `job_common_i6` a `ON CONFLICT DO NOTHING` ji zahodí.
 * `queued_count` tedy nikdy nepřeleze jedničku a mez se nemá jak překročit,
 * ať se nastaví jakkoli nízko. Zapnout ji by znamenalo mít hlášení, které
 * z principu nikdy nenastane, a to je horší než žádné: vypadá jako pojistka.
 *
 * CO SE TEDY HLÍDÁ. Přesně ta situace, ve které se zahazování stane poruchou:
 * ve frontě leží nedokončený tik (`state <= 'active'`) déle, než je vlastní
 * expirace té fronty. Od té chvíle se každý další tik zahodí, aniž by o tom
 * kdokoli věděl. Uvnitř expirace je zahození NORMÁLNÍ a žádoucí, přesně jak
 * to popisuje `discardNote` u každé cronové fronty; teprve za ní je to porucha.
 *
 * Dva stavy, které to chytí, a ani jeden dnes nikde vidět není:
 *
 *  - Tik uvízlý ve stavu `created`, protože frontu nemá kdo obsluhovat. Worker
 *    frontu bez handleru přesto zakládá i plánuje, řekne to jednou při startu
 *    a pak mlčí. Takový tik neexpiruje NIKDY (expirace se týká běžících úloh),
 *    takže fronta je zamčená natrvalo. Týká se to šesti cronových front, které
 *    jsou v `handler-coverage.test.ts` vedené jako nedodané.
 *  - Tik uvízlý ve stavu `active` déle, než je expirace, tedy stav, ve kterém
 *    ho měla dávno uklidit dozorčí smyčka pg-bossu. Když se nestalo, je porouchaná
 *    ta smyčka a mlčí i ona.
 *
 * Hlásí se to jako `warn` s názvem fronty, stářím tiku a jeho stavem, protože
 * bez názvu fronty je hlášení k ničemu: tichých cronů je v registru přes dvacet.
 */

/**
 * DRUHÝ HLÍDAČ, OPAČNÝ PŘÍPAD: FRONTA, DO KTERÉ SE NETIKÁ VŮBEC.
 *
 * Hlídač výš chytí frontu, která DRŽÍ nedokončený tik. Nechytí frontu, do
 * které žádný tik nepřišel, protože se zasekl plánovač: v tabulce úloh po ní
 * nic nezbude, takže není co měřit. Přitom je to ta horší porucha. Zaseknutý
 * tik je aspoň vidět v tabulce; po zastaveném plánování nezůstane nic a
 * kampaně se prostě přestanou odesílat.
 *
 * CO SE MĚŘÍ. U každé fronty, která je SKUTEČNĚ NAPLÁNOVANÁ, se porovná stáří
 * její poslední úlohy s násobkem periody jejího cronu. Perioda se počítá
 * z výrazu (`cronPeriodSeconds`), protože jeden společný práh pro plánovač
 * kampaní (tiká po patnácti sekundách) i pro týdenní ověření zálohy
 * neexistuje.
 *
 * KTERÉ FRONTY SE HLÍDAJÍ, A PROČ SE TO ČTE Z DATABÁZE. Výčet se bere
 * z `pgboss.schedule`, ne z registru. Od 7. 8. se totiž cronové fronty BEZ
 * OBSLUHY a fronty s obsluhou, která hlásí `needsDependencies`, schválně
 * NEPLÁNUJÍ a jejich plán se ruší (`registerQueues`). Ticho takové fronty je
 * záměr, ne porucha, a hlásit ho by znamenalo hlásit vlastní rozhodnutí jako
 * vadu. Tabulka `schedule` je přesně ten seznam, který z toho rozhodnutí
 * vyšel, takže se hlídač nemůže s registrem rozejít; kdyby se výčet opsal
 * z registru, musel by se ten výběr napsat podruhé a rozešel by se při první
 * změně. Průnik s registrem se přesto dělá, aby se hlídač nedotkl front,
 * které si zakládá sám pg-boss.
 *
 * ČERSTVÁ INSTALACE NENÍ PORUCHA. Instalace, která běží deset minut, nemá
 * úlohy žádné a denní úklid v ní opravdu ještě neproběhl. Když úlohy chybí,
 * měří se proto ticho od okamžiku, kdy se fronta NAPLÁNOVALA
 * (`schedule.created_on`), ne od začátku času. Ta značka přežije restart
 * workeru, na rozdíl od doby běhu procesu, takže se hlídač nevynuluje při
 * každém nasazení.
 *
 * SLEPÉ MÍSTO, KTERÉ SE PŘIZNÁVÁ. pg-boss maže dokončené úlohy po sedmi
 * dnech (`deletion_seconds`, výchozí hodnota). Delší ticho než sedm dní se
 * tedy z tabulky úloh doložit NEDÁ a hlídač ho tvrdit nebude: bez úloh se
 * ticho počítá nejvýš na tenhle týden. Prakticky to znamená, že týdenní
 * `platform.backup_verify` (tolerance tři týdny) tímhle hlídačem hlídané
 * není. Radši slepé místo, o kterém se ví, než hlášení opřené o to, že řádek
 * v tabulce chybí, což může znamenat obojí.
 */

/** Kolikanásobek periody se ještě považuje za normální rozestup. */
export const CRON_SILENCE_FACTOR = 3;

/**
 * Dolní mez tolerance. U front, které tikají po patnácti sekundách, by trojnásobek
 * periody znamenal poplach po pětačtyřiceti sekundách, tedy po každém nasazení
 * a po každém delším skenu. Poplach, který chodí při běžném provozu, se přestane
 * číst, a to je přesně ta vada, kterou tenhle hlídač řeší.
 */
export const CRON_SILENCE_FLOOR_SECONDS = 15 * 60;

/**
 * Jak daleko dozadu sahá důkaz. Odpovídá výchozímu `deletion_seconds` pg-bossu,
 * tedy sedmi dnům, po kterých knihovna dokončenou úlohu smaže.
 */
export const CRON_EVIDENCE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Jak dlouho smí mlčet plánovač cronu jako celek. pg-boss si značku
 * `pgboss.version.cron_on` posouvá po třiceti sekundách (`cronMonitorIntervalSeconds`),
 * takže pět minut je desetinásobná rezerva.
 */
export const CRON_MONITOR_TOLERANCE_SECONDS = 5 * 60;

/** Jak často se kontroluje. Pět minut: hlídá se porucha, ne průběh. */
export const CRON_WATCH_INTERVAL_MS = 5 * 60 * 1000;

export type CronWatchLogger = {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
};

export type CronWatchDb = {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * PAMĚŤ HLÍDAČE, ABY SE HLÁSILO JEDNOU, NE POŘÁD DOKOLA.
 *
 * Poučení, kvůli kterému tohle vzniklo, je změřené: `outbox.reconcile` nasbírala
 * 3 993 stejných selhání za čtyři dny a nikdo si jich nevšiml. **Hlášení, které
 * přijde tisíckrát denně a pokaždé stejné, není hlasitější než ticho, jen dražší.**
 * Hlídač běží po pěti minutách, takže bez paměti by jedna zaseknutá fronta
 * vydala 288 shodných řádků denně a zaplavila log tím, co se dozvěděl už první.
 *
 * Hlásí se tedy JEDNOU ZA EPIZODU: při prvním nálezu, a pak až zase po tom, co
 * se fronta rozběhla a zastavila znovu. Návrat do provozu se hlásí taky, jednou
 * a jako `info`: bez toho by se z logu nedalo poznat, jestli porucha trvá, nebo
 * se spravila.
 *
 * Stav drží volající, ne modul: kontrola musí zůstat funkcí, kterou jde spustit
 * v testu vícekrát za sebou bez úklidu mezi běhy.
 */
export type CronWatchState = {
  readonly stalled: Set<string>;
  readonly silent: Set<string>;
  monitorReported: boolean;
  /**
   * Nepovedené čtení se hlásí taky jednou. Chybějící právo na tabulku úloh se
   * po pěti minutách nespraví, takže by to jinak byl další stotisícový výpis
   * o jediné příčině.
   */
  readFailureReported: boolean;
};

export function createCronWatchState(): CronWatchState {
  return {
    stalled: new Set(),
    silent: new Set(),
    monitorReported: false,
    readFailureReported: false,
  };
}

/** Vydá hlášení o nepovedeném čtení jen tehdy, když se o něm ještě nehlásilo. */
function reportReadFailure(options: CronWatchOptions, error: unknown, message: string): void {
  const state = options.state;
  if (state?.readFailureReported === true) return;
  if (state) state.readFailureReported = true;
  options.logger.warn({ err: (error as Error).message }, message);
}

export type CronWatchOptions = {
  readonly db: CronWatchDb;
  readonly schema: string;
  readonly logger: CronWatchLogger;
  /**
   * Paměť už vydaných hlášení. Bez ní se hlásí každý nález pokaždé, což chtějí
   * testy jednotlivých kol; provoz si ji vytváří jednou v `startCronWatch`.
   */
  readonly state?: CronWatchState;
};

function assertSchema(schema: string): void {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(schema)) {
    throw new Error(
      `Schéma pg-bossu "${schema}" není platný identifikátor. Název se do dotazu ` +
        'vkládá textově, protože jím parametrizovat nejde, takže se kontroluje předem.',
    );
  }
}

/**
 * Vydá hlášení jen u fronty, o které se ještě nehlásilo, a nahlásí návrat těch,
 * které se mezitím rozběhly. Vrací seznam front, o kterých se právě hlásilo.
 */
function reportOnce(
  seen: Set<string>,
  current: readonly string[],
  emit: (queue: string) => void,
  recovered: (queues: string[]) => void,
): void {
  const now = new Set(current);
  const back = [...seen].filter((queue) => !now.has(queue));
  for (const queue of back) seen.delete(queue);
  if (back.length > 0) recovered(back);
  for (const queue of current) {
    if (seen.has(queue)) continue;
    seen.add(queue);
    emit(queue);
  }
}

export type StalledCronQueue = {
  queue: string;
  state: string;
  ageSeconds: number;
  expireSeconds: number;
};

/**
 * Jedno kolo kontroly. Vrací seznam zaseknutých front, aby se dal otestovat
 * bez čtení logu, a zároveň ho rovnou nahlásí.
 *
 * Výsledek se NEVYHAZUJE při chybě dotazu. Hlídač je diagnostika: kdyby shodil
 * workera, vyměnil by tiché zahazování tiků za hlasitý pád, což je horší obchod.
 * Chyba se zaloguje a příští kolo to zkusí znovu.
 */
export async function checkCronQueues(options: CronWatchOptions): Promise<StalledCronQueue[]> {
  assertSchema(options.schema);

  const entries = cronQueues();
  const names = entries.map((entry) => entry.name);
  const expireByName = new Map(entries.map((entry) => [entry.name, entry.expireInSeconds]));

  let rows: Record<string, unknown>[];
  try {
    // `DISTINCT ON` bere u každé fronty NEJSTARŠÍ nedokončený tik. Ten je ten
    // zajímavý: právě on drží klíč a kvůli němu se zahazují ty další.
    ({ rows } = await options.db.executeSql(
      `SELECT DISTINCT ON (name)
              name,
              state::text AS state,
              EXTRACT(EPOCH FROM (now() - created_on))::int AS age_seconds
         FROM "${options.schema}".job
        WHERE name = ANY($1::text[])
          AND state <= 'active'
        ORDER BY name, created_on ASC`,
      [names],
    ));
  } catch (error) {
    reportReadFailure(
      options,
      error,
      'hlídač cronových front nedokázal přečíst tabulku úloh; zahazované tiky tenhle běh nevidí',
    );
    return [];
  }

  const stalled: StalledCronQueue[] = [];
  for (const row of rows) {
    const queue = String(row['name']);
    const expireSeconds = expireByName.get(queue);
    if (expireSeconds === undefined) continue;
    const ageSeconds = Number(row['age_seconds']);
    if (!Number.isFinite(ageSeconds) || ageSeconds <= expireSeconds) continue;
    stalled.push({ queue, state: String(row['state']), ageSeconds, expireSeconds });
  }

  const byQueue = new Map(stalled.map((item) => [item.queue, item]));
  reportOnce(
    options.state?.stalled ?? new Set(),
    stalled.map((item) => item.queue),
    (queue) => {
      options.logger.warn(
        byQueue.get(queue)!,
        'cronová fronta drží nedokončený tik déle, než je její expirace: každý další tik ' +
          'se tiše zahazuje, protože politika exclusive nepustí druhou úlohu s týmž klíčem',
      );
    },
    (queues) => {
      options.logger.info({ queues }, 'zaseknutý tik se uvolnil, fronta zase zpracovává');
    },
  );
  return stalled;
}

export type SilentCronQueue = {
  queue: string;
  cron: string;
  /** Průměrná perioda cronu v sekundách. */
  periodSeconds: number;
  /** Od jaké doby ticha se to považuje za poruchu. */
  toleranceSeconds: number;
  silentForSeconds: number;
  /**
   * Odkud se ticho počítá. `last_job` je stáří poslední úlohy, `never_ran`
   * znamená, že ve frontě NENÍ ANI JEDNA úloha a ticho se počítá od chvíle,
   * kdy se fronta naplánovala.
   */
  since: 'last_job' | 'never_ran';
};

/** Zastavený plánovač cronu jako celek, tedy porucha nad všemi frontami naráz. */
export type CronMonitorSilence = { lastTickSeconds: number | null; toleranceSeconds: number };

export type SilenceReport = {
  monitor: CronMonitorSilence | null;
  queues: SilentCronQueue[];
};

/**
 * Jedno kolo hlídání ticha.
 *
 * KDYŽ MLČÍ CELÝ PLÁNOVAČ, HLÁSÍ SE JEDNA VĚTA, NE DVACET. pg-boss si značku
 * `pgboss.version.cron_on` posouvá po třiceti sekundách a dělá to tentýž kus
 * kódu, který zakládá tiky. Když stojí ta značka, stojí všechny fronty
 * a vypsat je jednu po druhé by znamenalo dvacet řádků o jediné příčině.
 * Per fronty se v tom kole už nehlásí nic; příště, až se plánovač rozběhne,
 * se hlásí jednotlivé fronty, které se nedohnaly.
 *
 * Chyba dotazu hlídač NESHODÍ, ze stejného důvodu jako u hlídače zaseknutých
 * tiků: diagnostika nesmí být příčinou pádu workeru.
 */
export async function checkSilentCronQueues(options: CronWatchOptions): Promise<SilenceReport> {
  assertSchema(options.schema);

  const byName = new Map(cronQueues().map((entry) => [entry.name, entry]));
  const names = [...byName.keys()];

  let monitorRows: Record<string, unknown>[];
  let scheduleRows: Record<string, unknown>[];
  try {
    ({ rows: monitorRows } = await options.db.executeSql(
      `SELECT EXTRACT(EPOCH FROM (now() - cron_on))::int AS last_tick_seconds
         FROM "${options.schema}".version`,
    ));
    // Stáří poslední úlohy fronty a stáří jejího plánu jedním dotazem. Sahá se
    // jen na fronty z registru, které mají řádek v `schedule`, takže se hlídač
    // nedotkne ani front pg-bossu, ani těch, které se schválně neplánují.
    ({ rows: scheduleRows } = await options.db.executeSql(
      `SELECT s.name,
              EXTRACT(EPOCH FROM (now() - s.created_on))::int AS scheduled_age_seconds,
              EXTRACT(EPOCH FROM (now() - max(j.created_on)))::int AS last_job_age_seconds
         FROM "${options.schema}".schedule AS s
         LEFT JOIN "${options.schema}".job AS j ON j.name = s.name
        WHERE s.name = ANY($1::text[])
        GROUP BY s.name, s.created_on`,
      [names],
    ));
  } catch (error) {
    reportReadFailure(
      options,
      error,
      'hlídač ticha cronových front nedokázal přečíst plán ani tabulku úloh; mlčící fronty ' +
        'tenhle běh nevidí',
    );
    return { monitor: null, queues: [] };
  }

  const rawTick = monitorRows[0]?.['last_tick_seconds'];
  // NULL znamená, že plánovač neposunul značku ANI JEDNOU. Na čerstvé instalaci
  // to platí prvních třicet sekund; tenhle hlídač poprvé běží až za pět minut.
  const lastTickSeconds = rawTick === null || rawTick === undefined ? null : Number(rawTick);
  const monitorStopped =
    monitorRows.length > 0 &&
    (lastTickSeconds === null || lastTickSeconds > CRON_MONITOR_TOLERANCE_SECONDS);

  if (monitorStopped) {
    const monitor: CronMonitorSilence = {
      lastTickSeconds,
      toleranceSeconds: CRON_MONITOR_TOLERANCE_SECONDS,
    };
    const state = options.state;
    if (state === undefined || !state.monitorReported) {
      if (state) state.monitorReported = true;
      options.logger.warn(
        { ...monitor, scheduled: scheduleRows.length },
        'plánovač cronu se zastavil: pg-boss neposunul značku cron_on. Do žádné cronové ' +
          'fronty se netiká, takže se neodesílají naplánované kampaně ani neběží noční úklidy',
      );
    }
    return { monitor, queues: [] };
  }
  if (options.state?.monitorReported) {
    options.state.monitorReported = false;
    options.logger.info({}, 'plánovač cronu zase tiká');
  }

  const silent: SilentCronQueue[] = [];
  for (const row of scheduleRows) {
    const queue = String(row['name']);
    const entry = byName.get(queue);
    if (entry === undefined) continue;
    const periodSeconds = cronPeriodSeconds(entry.cron);
    // Výrazu, kterému nerozumíme, se nevymýšlí perioda. Že se to netýká žádné
    // fronty z registru, hlídá test `cron-period.test.ts` v jádře.
    if (periodSeconds === undefined) continue;

    const toleranceSeconds = Math.max(
      periodSeconds * CRON_SILENCE_FACTOR,
      CRON_SILENCE_FLOOR_SECONDS,
    );
    const rawLastJob = row['last_job_age_seconds'];
    const scheduledAge = Number(row['scheduled_age_seconds']);
    let silentForSeconds: number;
    let since: SilentCronQueue['since'];
    if (rawLastJob === null || rawLastJob === undefined) {
      if (!Number.isFinite(scheduledAge)) continue;
      // Bez úloh se ticho tvrdí nejvýš na dobu, po kterou by úloha v tabulce
      // ještě ležela. Starší ticho z chybějícího řádku doložit nejde.
      silentForSeconds = Math.min(scheduledAge, CRON_EVIDENCE_WINDOW_SECONDS);
      since = 'never_ran';
    } else {
      silentForSeconds = Number(rawLastJob);
      if (!Number.isFinite(silentForSeconds)) continue;
      since = 'last_job';
    }
    if (silentForSeconds <= toleranceSeconds) continue;
    silent.push({
      queue,
      cron: entry.cron,
      periodSeconds,
      toleranceSeconds,
      silentForSeconds,
      since,
    });
  }

  const byQueue = new Map(silent.map((item) => [item.queue, item]));
  reportOnce(
    options.state?.silent ?? new Set(),
    silent.map((item) => item.queue),
    (queue) => {
      const item = byQueue.get(queue)!;
      options.logger.warn(
        item,
        item.since === 'never_ran'
          ? 'cronová fronta je naplánovaná, ale nedoběhla ANI JEDNOU: v tabulce úloh po ní ' +
              'není nic, přestože od naplánování uplynul víc než trojnásobek její periody'
          : 'cronová fronta mlčí: poslední úloha je starší než trojnásobek periody jejího ' +
              'cronu, takže se do ní přestalo tikat',
      );
    },
    (queues) => {
      options.logger.info({ queues }, 'mlčící cronová fronta se zase rozběhla');
    },
  );
  return { monitor: null, queues: silent };
}

/**
 * Spustí hlídač na pozadí. Vrací funkci, která ho zastaví; registruje se do
 * odstávky, aby proces nedržel běžící časovač.
 *
 * Obě kontroly jdou po sobě, ne souběžně: je to diagnostika na pozadí a dva
 * dotazy naráz by si jen braly spojení z bazénu, který patří úlohám.
 *
 * `unref()` je tu schválně: hlídač nesmí být důvod, proč proces nekončí.
 */
export function startCronWatch(options: CronWatchOptions & { intervalMs?: number }): () => void {
  // Paměť vydaných hlášení žije po celou dobu běhu workeru, ne po jedno kolo.
  const withState: CronWatchOptions = {
    ...options,
    state: options.state ?? createCronWatchState(),
  };
  const timer = setInterval(() => {
    void (async () => {
      await checkCronQueues(withState);
      await checkSilentCronQueues(withState);
    })();
  }, options.intervalMs ?? CRON_WATCH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
