import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config';
import { withoutContext } from '../../tx';
import { INTERNAL_QUEUE_PREFIX, QUEUE_REGISTRY } from '../../queues';

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

// Interní fronta pg-bossu. Konstanta se přestěhovala do registru front, protože
// ji potřebuje i kontrola na fronty mimo registr v `apps/worker/src/boss.ts`;
// dvě kopie téhož řetězce by se dřív nebo později rozešly. Zdůvodnění je u ní.

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
    /**
     * Rozpis těch pádů po frontách i s odpovědí, jestli fronta potom znovu
     * proběhla. Bez toho je číslo výš jen poplach: nedá se z něj poznat, co
     * selhalo ani jestli to ještě trvá.
     */
    failures: QueueFailure[];
    /** Okno, za které platí `failedRecently`. Posílá se ven, aby ho popisek řekl. */
    failedWindowHours: number;
    /**
     * Leží v dead letter frontě a NIKDO to nezpracuje. Fronta `<název>.dlq`
     * nemá obsluhu schválně: je to místo, kam spadne práce, kterou se nepovedlo
     * dokončit ani po všech pokusech, a čeká na člověka. Číslo, které se samo
     * nesníží, je proto silnější příznak poruchy než počet selhání.
     */
    deadLetter: number;
    /**
     * Co v těch dead letter frontách konkrétně leží. Nejvýš `DEAD_LETTER_SAMPLE`
     * položek; `deadLetter` výš je úplný počet.
     */
    deadLetterItems: DeadLetterItem[];
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
  dlq_queues: string[] | null;
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

/** Fronta, která za okno aspoň jednou spadla, a co se s ní dělo potom. */
export type QueueFailure = {
  /** Technický název fronty. Ukazuje se, aby šlo dohledat, o co jde. */
  queue: string;
  /** Věta z registru front, co ta fronta vlastně dělá. */
  description: string;
  failures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  /**
   * Proběhla fronta po posledním pádu znovu? Je to tvrzení o MECHANISMU, ne
   * o té konkrétní úloze; ta může pořád ležet odložená stranou.
   */
  recovered: boolean;
};

type FailureRow = {
  name: string;
  failures: string | number | null;
  last_failure_at: Date | string | null;
  last_success_at: Date | string | null;
};

let failedCache: { at: number; value: { total: number; queues: QueueFailure[] } } | null = null;

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

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Věta z registru front. Technický název sám o sobě uživateli neřekne nic:
 * `outbox.reconcile` je pro něj šum, kdežto „Srovná počty v outboxu" je věta,
 * ze které pozná, jestli se ho to týká.
 *
 * Neznámá fronta vrátí prázdný řetězec, ne výmluvu. Stát se to může u fronty,
 * která z registru zmizela a v tabulce úloh po ní ještě něco leželo.
 */
function describeQueue(name: string): string {
  const description = QUEUE_REGISTRY.find((entry) => entry.name === name)?.description ?? '';
  return firstSentence(description);
}

/**
 * První věta popisu, ne celý popis.
 *
 * Popisy v registru jsou psané pro toho, kdo bude frontu upravovat, takže za
 * první větou často pokračují vnitřnostmi. U `contacts.import` je za ní
 * „Klíč je ID importu, tedy jeden běh nad jedním importem; jeden běžící import
 * na projekt hlídá confirmImport, ne fronta", což majiteli projektu neřekne
 * nic a na obrazovce jen ubírá místo tomu podstatnému. První věta odpovídá na
 * otázku „co to dělá" a tím to končí.
 */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * Chyba pro obrazovku, zkrácená a bez cest na disku serveru.
 *
 * Naměřeno 8. 8. 2026 na panelu: uživateli se ukázalo
 * „ENOENT: no such file or directory, open '/Users/…/.dev-data/imports/019f…/3e78….csv'".
 * Absolutní cesta mu neřekne nic, zabere celý řádek a je to zbytečný pohled
 * do útrob serveru. Jméno souboru zůstává, podle něj se dá věc dohledat.
 */
function readableReason(reason: string): string {
  return reason.replace(/(['"]?)(\/[^'"\s]*\/)([^'"\s/]+)\1/g, '$1$3$1').slice(0, 300);
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
/**
 * Pády za okno ROZEPSANÉ PO FRONTÁCH, a u každé fronty odpověď na otázku,
 * kterou samotné číslo nezodpoví: povedlo se jí to potom?
 *
 * PROČ SAMOTNÉ ČÍSLO NESTAČÍ. Na panelu stálo „SELHALO ZA 24 H: 28" a nic víc.
 * Z toho se nedá poznat, co selhalo, jestli to mezitím proběhlo znovu, ani
 * jestli kvůli tomu něco neodešlo. Zadavatel to shrnul 8. 8. 2026 takhle:
 * „uživatel bude zmatený co selhalo, jestli to proběhlo znovu nebo jestli něco
 * nebylo doručeno, prostě nebude vědět z této obrazovky co se děje a bude si
 * myslet, že systém nefunguje". Číslo bez odpovědi je poplašná zpráva.
 *
 * Naměřeno tentýž den na vývojové instalaci: všech 28 pádů pocházelo ze dvou
 * uzavřených epizod, chybějícího údržbového připojení a jedné fronty, která
 * neměla zapojené závislosti. VŠECHNY postižené fronty od té doby znovu
 * proběhly. Panel přesto tvrdil „Něco se nezpracovává samo".
 *
 * ZOTAVENÍ SE POČÍTÁ NA FRONTĚ, NE NA ÚLOZE, a je v tom rozdíl, který se
 * nesmí zamluvit. „Fronta od té doby znovu proběhla" znamená, že mechanismus
 * jede dál; NEZNAMENÁ to, že se dokončila právě ta úloha, která spadla. Úloha,
 * která vyčerpala pokusy, leží v dead letter frontě a panel ji vypisuje zvlášť.
 * Právě tam patří odpověď na otázku „nebylo něco doručeno".
 *
 * CENA. Jeden průchod oknem místo poddotazu na frontu. Naměřeno na 88 000
 * řádcích: 46 ms, kdežto varianta s poddotazem na poslední úspěch u každé
 * fronty 1 294 ms. Je to LEVNĚJŠÍ než dotaz, který tu byl předtím a uměl jen
 * spočítat pády (238 ms), a přitom vrací mnohem víc.
 */
async function failedRecently(
  schema: ReturnType<typeof sql.identifier>,
): Promise<{ total: number; queues: QueueFailure[] }> {
  const now = Date.now();
  if (failedCache !== null && now - failedCache.at < FAILED_CACHE_MS) return failedCache.value;

  const { rows } = await withoutContext((tx) =>
    tx.execute<FailureRow>(sql`
      SELECT name,
             count(*) FILTER (WHERE state = 'failed') AS failures,
             max(created_on) FILTER (WHERE state = 'failed') AS last_failure_at,
             max(completed_on) FILTER (WHERE state = 'completed') AS last_success_at
        FROM ${schema}.job
       WHERE name NOT LIKE ${`${INTERNAL_QUEUE_PREFIX}%`}
         AND created_on > now() - make_interval(hours => ${FAILED_WINDOW_HOURS})
       GROUP BY name
      HAVING count(*) FILTER (WHERE state = 'failed') > 0
       ORDER BY 2 DESC, 1`),
  );

  const queues = rows.map((row) => {
    const lastFailure = toIso(row.last_failure_at);
    const lastSuccess = toIso(row.last_success_at);
    return {
      queue: row.name,
      description: describeQueue(row.name),
      failures: toNumber(row.failures),
      lastFailureAt: lastFailure,
      lastSuccessAt: lastSuccess,
      // Bez data pádu se zotavení tvrdit nedá, a tvrdit ho naslepo by bylo
      // horší než nevědět: uklidnilo by to přesně tam, kde uklidnit nesmí.
      recovered: lastFailure !== null && lastSuccess !== null && lastSuccess > lastFailure,
    };
  });

  const value = { total: queues.reduce((sum, queue) => sum + queue.failures, 0), queues };
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
/**
 * Kolik v dead letter frontách leží věcí, se kterými má člověk co dělat.
 *
 * PRÁZDNÝ TIK CRONU SE NEPOČÍTÁ, a je to celý smysl téhle funkce. Do DLQ spadne
 * všechno, co vyčerpalo pokusy, tedy i tik pravidelné úlohy, který se netrefil
 * do výpadku (restart workeru, chvilkově nedostupná databáze). Takový tik NENÍ
 * nedokončená práce: za pár minut tikne další a dohoní ho. Naměřeno 8. 8. 2026:
 * z dvou položek na panelu byla jedna skutečně selhaný import s chybějícím
 * souborem a druhá prázdný tik `contacts.recover_stale_imports` z restartu.
 * Panel na to rozsvítil červenou a napsal „Něco se nezpracovává samo… pomůže
 * správce instalace", tedy vyzval k akci, kterou nemá kdo a proč udělat.
 *
 * Rozlišuje se nákladem: úloha od producenta nese data nebo klíč pro slučování,
 * tik z cronu nemá ani jedno. Je to táž podmínka, jakou používá
 * `purgeStuckCronTicks` v `apps/worker/src/boss.ts`, a schválně stejná: dvě
 * různá pravidla pro totéž by znamenala, že se panel a úklid rozejdou.
 *
 * CENA. Zbytek souboru se `pgboss.job` schválně vyhýbá, protože agregace přes
 * něj je sekvenční sken. Naměřeno na vývojové databši s 88 000 řádky:
 * `WHERE name LIKE '%.dlq'` stojí 93 ms, kdežto týž dotaz s VYJMENOVANÝMI
 * frontami 0,27 ms. Levný dotaz nad `pgboss.queue` proto napřed vybere fronty,
 * ve kterých vůbec něco leží, a tenhle se ptá jen na ně. V běžném stavu, kdy je
 * DLQ prázdná, se nespustí vůbec.
 */
/** Jedna odložená úloha, tak jak ji má vidět člověk, ne jako číslo v součtu. */
export type DeadLetterItem = {
  /** Fronta, ze které úloha vypadla. Bez přípony `.dlq`, ta uživateli nic neříká. */
  queue: string;
  description: string;
  at: string | null;
  /** První řádek chyby. Celý zásobník volání na obrazovku nepatří. */
  reason: string;
};

/** Kolik položek se vypíše jmenovitě. Zbytek se shrne číslem. */
const DEAD_LETTER_SAMPLE = 5;

/**
 * Co konkrétně leží odložené stranou.
 *
 * Panel dosud ukazoval jen POČET a k němu větu „Něco se nezpracovává samo…
 * pomůže správce instalace". Správce ale neměl čím pomoct: obrazovka ani
 * příkaz, kterým se do těch front dá podívat, neexistovaly, takže výzva
 * k akci neměla adresáta. Tohle je ta chybějící odpověď na otázku „nebylo
 * něco doručeno": tady leží práce, která se nedokončila a sama se nedokončí.
 */
async function deadLetterItems(
  s: ReturnType<typeof sql.identifier>,
  queues: string[],
): Promise<DeadLetterItem[]> {
  if (queues.length === 0) return [];
  const names = sql.join(
    queues.map((queue) => sql`${queue}`),
    sql`, `,
  );
  const { rows } = await withoutContext((tx) =>
    tx.execute<{ name: string; created_on: Date | string | null; reason: string | null }>(sql`
      SELECT name, created_on,
             coalesce(output->>'message', split_part(output->>'stack', chr(10), 1),
                      output::text) AS reason
        FROM ${s}.job
       WHERE name IN (${names})
         AND state < 'active'
         AND (data <> '{}'::jsonb OR singleton_key IS NOT NULL)
       ORDER BY created_on DESC
       LIMIT ${DEAD_LETTER_SAMPLE}`),
  );
  return rows.map((row) => {
    const queue = row.name.replace(/\.dlq$/, '');
    return {
      queue,
      description: describeQueue(queue),
      at: toIso(row.created_on),
      reason: readableReason(row.reason ?? ''),
    };
  });
}

async function realDeadLetter(s: ReturnType<typeof sql.identifier>, queues: string[]) {
  if (queues.length === 0) return 0;
  /*
   * Jména se vkládají přes `sql.join`, ne jako pole do `= ANY($1::text[])`.
   * Drizzle pole v šablonovém výrazu ROZBALÍ na jednotlivé parametry, takže
   * z toho vyjde `ANY(($1, $2)::text[])`, což Postgres odmítne. Naměřeno:
   * celý panel pak spadl do stavu `unknown`, tedy „nedalo se změřit nic",
   * a chybějící číslo vypadalo jako mrtvý worker.
   */
  const names = sql.join(
    queues.map((queue) => sql`${queue}`),
    sql`, `,
  );
  const { rows } = await withoutContext((tx) =>
    tx.execute<{ count: string | number }>(sql`
      SELECT count(*) AS count FROM ${s}.job
       WHERE name IN (${names})
         AND state < 'active'
         AND (data <> '{}'::jsonb OR singleton_key IS NOT NULL)`),
  );
  const row = rows[0];
  return row ? toNumber(row.count) : 0;
}

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
               -- Jen JMÉNA dead letter front, ve kterých vůbec něco leží. Počet
               -- se z nich dopočítá zvlášť ve funkci realDeadLetter. Obrácený
               -- apostrof se sem psát NESMÍ, ukončil by šablonový literál.
               array_remove(
                 array_agg(q.name) FILTER (WHERE q.is_dlq AND q.queued_count > 0),
                 NULL
               ) AS dlq_queues,
               count(*) FILTER (WHERE NOT q.is_dlq AND NOT q.is_internal) AS registered,
               (SELECT count(*) FROM ${s}.schedule) AS cron_scheduled
          FROM (
            SELECT name, queued_count, active_count,
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
          failures: [],
          failedWindowHours: FAILED_WINDOW_HOURS,
          deadLetter: 0,
          deadLetterItems: [],
        },
        queues: { registered: 0, cronExpected, cronScheduled: 0 },
        error: 'fronta neodpověděla ani prázdným řádkem',
      };
    }

    const secondsSince = row.seconds_since === null ? null : toNumber(row.seconds_since);
    const lastSeen = row.last_seen_at;
    const dlqQueues = row.dlq_queues ?? [];
    const failed = await failedRecently(s);
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
        failedRecently: failed.total,
        failures: failed.queues,
        failedWindowHours: FAILED_WINDOW_HOURS,
        deadLetter: await realDeadLetter(s, dlqQueues),
        deadLetterItems: await deadLetterItems(s, dlqQueues),
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
        failures: [],
        failedWindowHours: FAILED_WINDOW_HOURS,
        deadLetter: 0,
        deadLetterItems: [],
      },
      queues: { registered: 0, cronExpected, cronScheduled: 0 },
      error: (error as Error).message,
    };
  }
}
