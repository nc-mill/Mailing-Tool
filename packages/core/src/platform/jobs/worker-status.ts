import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config';
import { withoutContext } from '../../tx';
import { QUEUE_REGISTRY } from '../../queues';

/**
 * STAV ZPRACOVÁNÍ NA POZADÍ, tedy odpověď na otázku „běží worker, nebo to
 * někde visí".
 *
 * PROČ TENHLE SOUBOR VZNIKL. Centrum úloh do teď ukazovalo jen dva doménové
 * zdroje (import kontaktů a stavbu publika kampaně). Naměřeno 7. 8. na
 * `mlain_clean`: za třicet minut prošlo frontou 188 úloh `__pgboss__send-it`,
 * po 25 ticích `campaign.scheduler`, `campaign.watchdog`, `outbox.stall_watch`
 * a `tracking.refresh_campaign_progress`, k tomu 8 SELHANÝCH běhů
 * `outbox.reconcile`. Na obrazovce z toho nebylo NIC. Uživatel viděl dvě úlohy
 * a měl za to, že se nic neděje, nebo naopak že mu visí import, přestože
 * worker jel a padalo něco úplně jiného.
 *
 * CO SE MĚŘÍ A ODKUD. Všechno z tabulek pg-bossu, které aplikační role
 * `mlain_app` čte i bez kontextu projektu: schéma `pgboss` nemá řádkovou
 * bezpečnost a `mlain_app` v něm má SELECT (migrace 0007 mu dala USAGE
 * a CREATE, tabulky zakládá pg-boss sám). Žádná nová tabulka, žádný nový
 * heartbeat, žádné obcházení izolace projektů: fronta ŽÁDNÝ `workspace_id`
 * nemá, takže se z ní ani nedá číst po projektech.
 *
 * ČÍSLA SE NEPOČÍTAJÍ Z `pgboss.job`, ALE Z `pgboss.queue`, a je to rozdíl
 * mezi 240 ms a jednou milisekundou. `pgboss.job` má na čtvrtý den provozu
 * 70 000 řádků a agregace přes stavy je nad ním paralelní sekvenční sken
 * (změřeno `EXPLAIN ANALYZE`, 240 ms, a poroste do stropu daného `deletion_seconds`,
 * tedy sedmi dnů). `pgboss.queue` má 96 řádků a nese tytéž počty předpočítané:
 * monitor pg-bossu je tam přepisuje každou minutu příkazem `cacheQueueStats`
 * (`plans.js`), a to DOSLOVA jako
 *
 *   queued_count = count(*) FILTER (WHERE state < 'active')
 *   active_count = count(*) FILTER (WHERE state = 'active')
 *   failed_count = count(*) FILTER (WHERE state = 'failed')
 *
 * Tedy MOMENTKA, ne kumulativní čítač. Sedm dní je ale na obrazovku PŘÍLIŠ
 * DLOUHO: `failed_count` se proto nepoužívá vůbec a selhání se počítají za
 * den vlastním dotazem, viz `failedRecently`.
 *
 * NEPOUŽÍVÁ SE `pgboss.queue_stats`. Vypadá jako správnější zdroj (historie
 * po snímcích), jenže je PRÁZDNÁ: ukládání snímků je v pg-bossu volitelné
 * (`persistQueueStats`) a worker si ho nezapíná. Oddíly té tabulky navíc končí
 * dva dny zpátky. Číst z ní by znamenalo hlásit nuly a tvářit se přitom
 * nejpřesněji ze všech.
 */

/**
 * Interní fronta pg-bossu. Nepatří do žádného počtu: uživatel ji nezaložil,
 * nikdo ji nespravuje a jejích 42 000 doběhlých úloh by v součtu přebilo
 * všechnu skutečnou práci.
 */
const INTERNAL_QUEUE_PREFIX = '__pgboss__';

/**
 * Jak dlouho se po posledním projevu ještě věří, že worker běží.
 *
 * ODKUD TA ČÍSLA JSOU, a schválně nejsou vymyšlená: pg-boss sám posouvá
 * `version.cron_on` po třiceti sekundách (`cronMonitorIntervalSeconds`),
 * `version.flow_on` po jednotkách sekund a `queue.monitor_on` po minutě
 * (`monitorStateIntervalSeconds`). Nejpomalejší z těch tří je tedy minuta.
 *
 * `WORKER_LATE_SECONDS` je dvojnásobek nejpomalejšího cyklu. Kratší mez by
 * hlásila poruchu pokaždé, když se jeden cyklus opozdí o pár vteřin, a hláška,
 * která bliká, se přestane číst. `WORKER_DOWN_SECONDS` je desetinásobek: po
 * deseti minutách ticha se už nedá tvrdit, že jde o zpoždění.
 *
 * Mezistupeň `late` tu je proto, že „worker je mrtvý" a „worker se chvíli
 * neozval" jsou pro uživatele dvě různé zprávy. První znamená zavolat správce,
 * druhá znamená počkat.
 */
export const WORKER_LATE_SECONDS = 2 * 60;
export const WORKER_DOWN_SECONDS = 10 * 60;

/**
 * `unknown` NENÍ totéž co `down`, a plete se to snadno.
 *
 * `down` znamená naměřené ticho: fronta odpověděla a poslední projev workeru
 * je starý. `unknown` znamená, že se nedalo změřit nic, typicky protože
 * schéma pg-bossu neexistuje (instalace se nemigrovala) nebo databáze
 * neodpověděla. Napsat v tom případě „worker neběží" by ukázalo prstem na
 * nesprávnou součástku.
 */
export type WorkerState = 'running' | 'late' | 'down' | 'unknown';

export type WorkerStatus = {
  state: WorkerState;
  /** Poslední projev workeru, tedy nejnovější ze tří značek pg-bossu. */
  lastSeenAt: string | null;
  secondsSinceLastSeen: number | null;
  queue: {
    /** Čeká na zpracování: stav `created` nebo `retry`, bez dead letter front. */
    waiting: number;
    /** Právě se zpracovává: stav `active`. */
    running: number;
    /**
     * Selhalo ZA POSLEDNÍCH `failedWindowHours`, ne za celou historii.
     *
     * PROČ NE CELKEM, a je to oprava po ostrém používání: 7. 8. stálo na panelu
     * „SELHALO 4 142" a zadavatele to vyděsilo, přestože 4 116 z toho byla
     * JEDNA fronta padající od 3. srpna, která se mezitím spravila, a od
     * restartu v 15:58 nepřibyl ani jeden pád. Naměřeno v tutéž chvíli: za
     * 24 hodin 610 pádů, za poslední hodinu 15. Celkové číslo bez časového
     * rámce je poplašná zpráva, ne informace: nedá se z něj poznat, jestli je
     * porucha právě teď, nebo byla před týdnem.
     */
    failedRecently: number;
    /** Okno, za které platí `failedRecently`. Posílá se ven, aby ho popisek řekl. */
    failedWindowHours: number;
    /**
     * Leží v dead letter frontě a NIKDO to nezpracuje. Fronta `<název>.dlq`
     * nemá obsluhu schválně: je to místo, kam spadne práce, kterou se nepovedlo
     * dokončit ani po všech pokusech, a čeká na člověka. Číslo, které se samo
     * nesníží, je proto silnější příznak poruchy než počet selhání.
     */
    deadLetter: number;
  };
  queues: {
    /** Fronty založené v instalaci, bez interních a bez dead letter. */
    registered: number;
    /** Cronové fronty podle registru, tedy kolik jich MÁ pravidelně tikat. */
    cronExpected: number;
    /** Cronové fronty, které v `pgboss.schedule` doopravdy plán mají. */
    cronScheduled: number;
  };
};

type StatusRow = {
  last_seen_at: Date | string | null;
  seconds_since: string | number | null;
  waiting: string | number | null;
  running: string | number | null;
  dead_letter: string | number | null;
  registered: string | number | null;
  cron_scheduled: string | number | null;
};

/**
 * Za jak dlouhou dobu se počítají selhání.
 *
 * DEN, NE HODINA. Hodina by u fronty, která tiká po pěti minutách, klidně
 * ukázala nulu uprostřed poruchy trvající od rána; den zachytí i noc, kterou
 * nikdo neviděl, a přitom nenese pády, které se dávno spravily.
 */
export const FAILED_WINDOW_HOURS = 24;

/**
 * Jak dlouho platí naměřený počet selhání, než se změří znovu.
 *
 * TENHLE JEDINÝ ÚDAJ SE NEDÁ VZÍT Z `pgboss.queue`. Tamní `failed_count` je
 * momentka VŠECH uchovávaných selhání, tedy sedmi dnů, a žádné okno v ní není.
 * Za den se proto musí počítat z `pgboss.job`, a to je sekvenční sken:
 * `EXPLAIN ANALYZE` na čtvrtý den provozu 238 ms nad 71 000 řádky, se stropem
 * daným `deletion_seconds` (sedm dní).
 *
 * Mezipaměť je tu proto, aby ten sken NEPLATIL KAŽDÝ OTEVŘENÝ PANEL. Panel se
 * ptá po třiceti sekundách, takže s dvaceti sekundami platnosti dostane každý
 * dotaz čerstvé číslo, ale deset otevřených záložek nebo pět lidí naráz sdílí
 * jeden sken. Je to jediná cena, kterou tenhle panel databázi působí, a je
 * vědomá: číslo bez časového rámce by bylo levné a k ničemu.
 */
const FAILED_CACHE_MS = 20_000;

let failedCache: { at: number; value: number } | null = null;

/** Jen pro testy: zapomene naměřený počet selhání. */
export function resetFailedCache(): void {
  failedCache = null;
}

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  // Líně a jednou, stejně jako v `contacts/jobs/enqueue.ts`: import modulu
  // nesmí vyžadovat kompletní prostředí, jinak se nedá naimportovat v testu.
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetWorkerStatusConfig(): void {
  cachedSchema = null;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stateFor(secondsSince: number | null): WorkerState {
  if (secondsSince === null) return 'unknown';
  if (secondsSince <= WORKER_LATE_SECONDS) return 'running';
  if (secondsSince <= WORKER_DOWN_SECONDS) return 'late';
  return 'down';
}

/**
 * Kolik cronových front má podle registru tikat.
 *
 * Čte se z registru, ne z databáze, a je to schválně: `pgboss.schedule` nese
 * jen ty, které worker doopravdy naplánoval, takže bez druhé strany by rozdíl
 * nebyl vidět. A ten rozdíl je právě ta zajímavá informace. `registerQueues`
 * od 7. 8. cronovou frontu BEZ OBSLUHY neplánuje a její plán ruší, aby tik
 * neuvízl ve frontě, kterou nikdo nečte. Číslo `cronExpected - cronScheduled`
 * tedy říká, kolik cronových front tenhle build nemá čím obsloužit.
 */
export function cronQueuesExpected(): number {
  return QUEUE_REGISTRY.filter((entry) => entry.cron !== undefined).length;
}

/**
 * Počet selhání za okno. Jediný dotaz tohohle panelu, který sahá na
 * `pgboss.job`; proč to jinak nejde a proč se výsledek drží v paměti, je
 * u `FAILED_CACHE_MS`.
 *
 * Interní fronta pg-bossu se vynechává stejně jako všude jinde v tomhle
 * souboru, aby se čísla panelu počítala z jedné a téže množiny front.
 */
async function failedRecently(schema: ReturnType<typeof sql.identifier>): Promise<number> {
  const now = Date.now();
  if (failedCache !== null && now - failedCache.at < FAILED_CACHE_MS) return failedCache.value;

  const { rows } = await withoutContext((tx) =>
    tx.execute<{ failed: string | number | null }>(sql`
      SELECT count(*) AS failed
        FROM ${schema}.job
       WHERE state = 'failed'
         AND name NOT LIKE ${`${INTERNAL_QUEUE_PREFIX}%`}
         AND created_on > now() - make_interval(hours => ${FAILED_WINDOW_HOURS})`),
  );
  const value = toNumber(rows[0]?.failed);
  failedCache = { at: now, value };
  return value;
}

/**
 * Stav workeru a fronty.
 *
 * NEVYHAZUJE. Selhání se překládá na `state: 'unknown'` s nulami, protože
 * tohle je diagnostický panel: obrazovka, která se kvůli němu celá rozsype,
 * je horší než panel, který přizná, že neměřil. Chyba se přitom neztratí,
 * volající ji dostane v `error`.
 */
export async function readWorkerStatus(): Promise<WorkerStatus & { error: string | null }> {
  const schema = pgbossSchema();
  if (!/^[A-Za-z0-9_]{1,50}$/.test(schema)) {
    throw new Error(
      `Schéma pg-bossu "${schema}" není platný identifikátor. Název se do dotazu vkládá ` +
        'jako identifikátor, ne jako parametr, takže se kontroluje předem.',
    );
  }
  const s = sql.identifier(schema);
  const cronExpected = cronQueuesExpected();

  try {
    const { rows } = await withoutContext((tx) =>
      tx.execute<StatusRow>(sql`
        WITH seen AS (
          SELECT GREATEST(
                   (SELECT max(GREATEST(v.cron_on, v.flow_on)) FROM ${s}.version AS v),
                   (SELECT max(q.monitor_on) FROM ${s}.queue AS q)
                 ) AS at
        )
        SELECT (SELECT at FROM seen) AS last_seen_at,
               (SELECT EXTRACT(EPOCH FROM (now() - at))::int FROM seen) AS seconds_since,
               -- Dead letter fronty se ze součtu čekajících VYNECHÁVAJÍ. Jejich
               -- úlohy nečekají na zpracování, čekají na člověka; kdyby se
               -- započítaly, tvrdil by panel „ve frontě čeká 1 úloha" o práci,
               -- kterou nikdo nikdy nevezme.
               coalesce(sum(q.queued_count) FILTER (WHERE NOT q.is_dlq AND NOT q.is_internal), 0)
                 AS waiting,
               coalesce(sum(q.active_count) FILTER (WHERE NOT q.is_internal), 0) AS running,
               coalesce(sum(q.queued_count) FILTER (WHERE q.is_dlq), 0) AS dead_letter,
               count(*) FILTER (WHERE NOT q.is_dlq AND NOT q.is_internal) AS registered,
               (SELECT count(*) FROM ${s}.schedule) AS cron_scheduled
          FROM (
            SELECT queued_count, active_count,
                   name LIKE ${`${INTERNAL_QUEUE_PREFIX}%`} AS is_internal,
                   name LIKE '%.dlq' AS is_dlq
              FROM ${s}.queue
          ) AS q`),
    );

    const row = rows[0];
    if (!row) {
      return {
        state: 'unknown',
        lastSeenAt: null,
        secondsSinceLastSeen: null,
        queue: {
          waiting: 0,
          running: 0,
          failedRecently: 0,
          failedWindowHours: FAILED_WINDOW_HOURS,
          deadLetter: 0,
        },
        queues: { registered: 0, cronExpected, cronScheduled: 0 },
        error: 'fronta neodpověděla ani prázdným řádkem',
      };
    }

    const secondsSince = row.seconds_since === null ? null : toNumber(row.seconds_since);
    const lastSeen = row.last_seen_at;
    return {
      state: stateFor(secondsSince),
      lastSeenAt:
        lastSeen === null
          ? null
          : lastSeen instanceof Date
            ? lastSeen.toISOString()
            : new Date(lastSeen).toISOString(),
      secondsSinceLastSeen: secondsSince,
      queue: {
        waiting: toNumber(row.waiting),
        running: toNumber(row.running),
        failedRecently: await failedRecently(s),
        failedWindowHours: FAILED_WINDOW_HOURS,
        deadLetter: toNumber(row.dead_letter),
      },
      queues: {
        registered: toNumber(row.registered),
        cronExpected,
        cronScheduled: toNumber(row.cron_scheduled),
      },
      error: null,
    };
  } catch (error) {
    return {
      state: 'unknown',
      lastSeenAt: null,
      secondsSinceLastSeen: null,
      queue: {
        waiting: 0,
        running: 0,
        failedRecently: 0,
        failedWindowHours: FAILED_WINDOW_HOURS,
        deadLetter: 0,
      },
      queues: { registered: 0, cronExpected, cronScheduled: 0 },
      error: (error as Error).message,
    };
  }
}
