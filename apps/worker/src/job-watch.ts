import { queue } from '@mlain/core/queues';
import {
  listJobsClaimingToRun,
  type ClaimedRunningJobRow,
} from '@mlain/core/platform/maintenance-scan';

/**
 * HLÍDAČ ÚLOH, KTERÉ TVRDÍ „BĚŽÍ", A PŘITOM VE FRONTĚ NIC NENÍ.
 *
 * PROČ VZNIKL. 7. 8. se naměřil skutečný případ: import `3e78e4df` měl
 * v `imports` stav `importing`, nula z dvou řádků, poslední zápis dvě hodiny
 * starý, a v `pgboss.job` k němu NEEXISTOVALA ŽÁDNÁ ÚLOHA. Rozhraní proto
 * poctivě ukazovalo „Import ještě běží" a ukazatel průběhu, který se nikdy
 * nepohnul. Ten konkrétní řádek způsobil zásah do vývojové databáze, ale
 * TOTÉŽ NASTANE PO PÁDU WORKERU UPROSTŘED IMPORTU, a to je provozní případ.
 *
 * DNEŠNÍ HLÍDAČE TO NECHYTÍ ANI JEDEN. `cron-watch.ts` hlídá dvě jiné věci:
 * zaseknutý TIK v cronové frontě a ticho fronty, do které se má tikat. Tohle
 * není ani jedno: fronta `contacts.import` cronová není, tiká se do ní z akce
 * uživatele, a její ticho je normální stav. `campaign.watchdog` uzavírá až
 * kampaně, které mají postavené publikum, takže kampaň uvízlou PŘED ním
 * přeskočí (`if (!c.audienceBuiltAt) continue`).
 *
 * CO SE MĚŘÍ. Porovnávají se dvě strany:
 *
 *  1. Co si o sobě myslí DOMÉNA: řádky, které Centrum úloh hlásí jako `running`
 *     (`listJobsClaimingToRun` v jádře, jede pod rolí `mlain_maintenance`).
 *  2. Co doopravdy leží ve FRONTĚ: nedokončené úlohy v `pgboss.job`, čtené
 *     tímtéž spojením, jakým je čte pg-boss.
 *
 * MĚŘÍ SE STÁŘÍ, NE POUHÁ NEPŘÍTOMNOST, a je to ta past, na kterou se tenhle
 * hlídač dá nejsnáz napsat špatně. Mezi zápisem doménového řádku a tím, než je
 * úloha vidět, je vždycky nějaké okno (jiná transakce, jiné spojení, replika),
 * a hlídač bez lhůty by hlásil každý čerstvě spuštěný import. Práh je proto
 * dvojí podmínka: řádek se NEHNUL déle než `idleMinutes` A ZÁROVEŇ k němu
 * ve frontě není nedokončená úloha.
 *
 * SLEPÉ MÍSTO, KTERÉ SE PŘIZNÁVÁ. Zabitý worker nechá svou úlohu ve stavu
 * `active`, dokud ji nevyprší pg-boss podle `expireInSeconds` (u importu šest
 * hodin). Do té doby ve frontě formálně LEŽÍ, takže tenhle hlídač mlčí,
 * přestože se nic neděje. Chytit to jde jedině heartbeatem, který ani jedna
 * z obou úloh nemá. Hlídač tedy pokrývá druhou půlku případů, tu horší: úlohu,
 * po které ve frontě NEZBYLO NIC.
 *
 * NIC NEOPRAVUJE, JEN HLÁSÍ. Oprava importu existuje a jmenuje se
 * `recoverStaleImportsJob` (`packages/core/src/contacts/import/jobs/queue-handlers.ts`),
 * jenže ji v produkčním kódu NIKDO NEVOLÁ: fronta `contacts.import.recover_stale`
 * v registru není a export má jediného uživatele, a to test. Zapojit ji znamená
 * sáhnout do registru front, což tenhle hlídač schválně nedělá; je to zapsané
 * jako nález.
 */

/**
 * Jak dlouho se řádek nesmí hnout, aby se považoval za osiřelý.
 *
 * Patnáct minut je stejná dolní mez jako `CRON_SILENCE_FLOOR_SECONDS`
 * u hlídače cronu a ze stejného důvodu: import zapisuje checkpoint po tisíci
 * řádcích a stavba publika po pěti tisících, takže u velkého souboru na pomalé
 * databázi může být rozestup mezi zápisy v jednotkách minut. Kratší lhůta by
 * hlásila poplach na běžícím importu, a poplach, který chodí při běžném
 * provozu, se přestane číst.
 */
export const JOB_ORPHAN_IDLE_MINUTES = 15;

/** Jak často se kontroluje. Pět minut: hlídá se porucha, ne průběh. */
export const JOB_WATCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Které doménové úlohy mají svou frontu a jak se v ní jmenuje jejich klíč.
 *
 * KLÍČ SE SKLÁDÁ TADY, ALE ŠABLONA SE HLÍDÁ PROTI REGISTRU. Kdyby se klíč
 * jen opsal, rozešel by se s producentem při první změně a hlídač by od té
 * chvíle hlásil KAŽDOU běžící úlohu jako osiřelou, tedy vyrobil by přesně tu
 * záplavu falešných poplachů, které se jinde brání. Shodu šablon proto měří
 * `job-watch.test.ts` proti `queue()` z registru front.
 */
export type WatchedJobKind = {
  readonly kind: ClaimedRunningJobRow['kind'];
  readonly queue: string;
  /** Doslovná hodnota `singletonKeyTemplate` v registru front. */
  readonly singletonKeyTemplate: string;
  readonly singletonKey: (id: string) => string;
};

export const WATCHED_JOB_KINDS: readonly WatchedJobKind[] = [
  {
    kind: 'import',
    queue: 'contacts.import',
    singletonKeyTemplate: '<import_id>',
    singletonKey: (id) => id,
  },
  {
    kind: 'campaign_audience',
    queue: 'campaign.materialize',
    singletonKeyTemplate: 'campaign.materialize:<campaign_id>',
    singletonKey: (id) => `campaign.materialize:${id}`,
  },
];

export type JobWatchLogger = {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
};

export type JobWatchDb = {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * PAMĚŤ HLÍDAČE, ABY SE HLÁSILO JEDNOU, NE POŘÁD DOKOLA.
 *
 * Totéž poučení jako u `cron-watch.ts`: hlídač běží po pěti minutách, takže by
 * jeden zaseknutý import vydal 288 shodných řádků denně. Osiřelá úloha se navíc
 * sama nespraví, takže by to trvalo, dokud si toho někdo nevšimne, což je přesně
 * ten stav, kvůli kterému hlídač vznikl.
 *
 * Návrat do pořádku se hlásí taky, jednou a jako `info`: bez toho by z logu
 * nešlo poznat, jestli porucha trvá, nebo se spravila.
 */
export type JobWatchState = {
  readonly reported: Set<string>;
  readFailureReported: boolean;
};

export function createJobWatchState(): JobWatchState {
  return { reported: new Set(), readFailureReported: false };
}

export type JobWatchOptions = {
  readonly db: JobWatchDb;
  readonly schema: string;
  readonly logger: JobWatchLogger;
  /**
   * Sken domény napříč projekty. Vyměnitelný kvůli testům; v provozu je to
   * `listJobsClaimingToRun`, tedy jediné místo, které smí číst přes projekty.
   */
  readonly scan?: (minIdleMinutes: number) => Promise<ClaimedRunningJobRow[]>;
  readonly idleMinutes?: number;
  /** Paměť už vydaných hlášení. Bez ní se hlásí každý nález pokaždé. */
  readonly state?: JobWatchState;
};

export type OrphanedJob = {
  workspaceId: string;
  kind: string;
  id: string;
  state: string;
  queue: string;
  idleSeconds: number;
};

function assertSchema(schema: string): void {
  if (!/^[A-Za-z0-9_]{1,50}$/.test(schema)) {
    throw new Error(
      `Schéma pg-bossu "${schema}" není platný identifikátor. Název se do dotazu ` +
        'vkládá textově, protože jím parametrizovat nejde, takže se kontroluje předem.',
    );
  }
}

/** Vydá hlášení o nepovedeném čtení jen tehdy, když se o něm ještě nehlásilo. */
function reportReadFailure(options: JobWatchOptions, error: unknown, message: string): void {
  const state = options.state;
  if (state?.readFailureReported === true) return;
  if (state) state.readFailureReported = true;
  options.logger.warn({ err: (error as Error).message }, message);
}

/**
 * Jedno kolo kontroly. Vrací nalezené osiřelé úlohy, aby se dal otestovat bez
 * čtení logu, a zároveň je rovnou nahlásí.
 *
 * PŘI CHYBĚ SE NEVYHAZUJE, ze stejného důvodu jako u hlídače cronu: diagnostika
 * nesmí být příčinou pádu workeru. Chyba se zaloguje a příští kolo to zkusí znovu.
 *
 * POŘADÍ DOTAZŮ JE ZÁMĚRNÉ: nejdřív fronta, pak doména. Kdyby se ptalo obráceně,
 * vzniklo by okno, ve kterém se úloha mezi oběma dotazy dokončí a zmizí z fronty,
 * a hlídač by ji nahlásil jako osiřelou. Takhle je okno na opačné straně, tedy
 * ve prospěch ticha: úloha zařazená mezi dotazy se nahlásí až o kolo později.
 */
export async function checkOrphanedJobs(options: JobWatchOptions): Promise<OrphanedJob[]> {
  assertSchema(options.schema);

  const idleMinutes = options.idleMinutes ?? JOB_ORPHAN_IDLE_MINUTES;
  const scan = options.scan ?? listJobsClaimingToRun;

  let queued: Set<string>;
  try {
    const { rows } = await options.db.executeSql(
      `SELECT name, singleton_key
         FROM "${options.schema}".job
        WHERE name = ANY($1::text[])
          AND state <= 'active'
          AND singleton_key IS NOT NULL`,
      [WATCHED_JOB_KINDS.map((entry) => entry.queue)],
    );
    queued = new Set(rows.map((row) => `${String(row['name'])} ${String(row['singleton_key'])}`));
  } catch (error) {
    reportReadFailure(
      options,
      error,
      'hlídač osiřelých úloh nedokázal přečíst tabulku úloh; úlohy bez odpovídající ' +
        'úlohy ve frontě tenhle běh nevidí',
    );
    return [];
  }

  let claimed: ClaimedRunningJobRow[];
  try {
    claimed = await scan(idleMinutes);
  } catch (error) {
    reportReadFailure(
      options,
      error,
      'hlídač osiřelých úloh nedokázal přečíst doménové tabulky napříč projekty; ' +
        'zaseknuté importy a rozestavěná publika tenhle běh nevidí',
    );
    return [];
  }

  const byKind = new Map(WATCHED_JOB_KINDS.map((entry) => [entry.kind, entry]));
  const orphans: OrphanedJob[] = [];
  for (const row of claimed) {
    const watched = byKind.get(row.kind);
    // Druh, ke kterému neznáme frontu, se NEHLÁSÍ. Nevíme, kde bychom jeho
    // úlohu hledali, takže „ve frontě nic není" by bylo tvrzení bez podkladu.
    if (watched === undefined) continue;
    if (queued.has(`${watched.queue} ${watched.singletonKey(row.id)}`)) continue;
    orphans.push({
      workspaceId: row.workspaceId,
      kind: row.kind,
      id: row.id,
      state: row.state,
      queue: watched.queue,
      idleSeconds: row.idleSeconds,
    });
  }

  report(options, orphans);
  return orphans;
}

/** Klíč paměti. Druh i ID, protože ID je unikátní jen v rámci druhu. */
function memoryKey(job: OrphanedJob): string {
  return `${job.kind}:${job.id}`;
}

function report(options: JobWatchOptions, orphans: OrphanedJob[]): void {
  const seen = options.state?.reported ?? new Set<string>();
  const now = new Set(orphans.map(memoryKey));

  const recovered = [...seen].filter((key) => !now.has(key));
  for (const key of recovered) seen.delete(key);
  if (recovered.length > 0) {
    options.logger.info(
      { jobs: recovered },
      'úloha, která se tvářila jako běžící bez úlohy ve frontě, se dořešila',
    );
  }

  for (const job of orphans) {
    const key = memoryKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    options.logger.warn(
      job,
      'úloha se tváří jako běžící, ale ve frontě k ní není žádná nedokončená úloha: ' +
        'uživatel vidí ukazatel průběhu, který se nikdy nepohne. Typicky po pádu workeru ' +
        'uprostřed běhu. Import se dá odblokovat zastavením v Centru úloh, kampaň zrušením.',
    );
  }
}

/**
 * Spustí hlídač na pozadí. Vrací funkci, která ho zastaví; registruje se do
 * odstávky, aby proces nedržel běžící časovač.
 *
 * `unref()` je tu schválně: hlídač nesmí být důvod, proč proces nekončí.
 */
export function startJobWatch(options: JobWatchOptions & { intervalMs?: number }): () => void {
  const withState: JobWatchOptions = {
    ...options,
    state: options.state ?? createJobWatchState(),
  };
  const timer = setInterval(() => {
    void checkOrphanedJobs(withState);
  }, options.intervalMs ?? JOB_WATCH_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Šablona klíče z registru front. Existuje kvůli testu, ne kvůli provozu. */
export function singletonKeyTemplateOf(name: string): string | undefined {
  return queue(name).singletonKeyTemplate;
}
