import type { WorkspaceContext } from '@mlain/db';
import type { Permission } from '../../identity/permissions';

/**
 * Stavy úlohy. Doslova ty, které zná `JobStatus` v packages/ui (P05, úkol 31).
 * Kdyby se rozešly, obrazovka by dostala stav, který neumí vykreslit.
 */
export const JOB_STATUSES = [
  'running',
  'paused',
  'completed',
  'completedWithErrors',
  'failed',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * DVA POJMY, KTERÉ SE DŘÍV PLETLY DO JEDNOHO, a stálo to odznak, který nešel
 * vynulovat.
 *
 * `UNFINISHED` je „úloha ještě neskončila". Podle toho se dělí seznam v Centru
 * úloh na část nahoře a na historii; `paused` sem patří, protože import čekající
 * na potvrzení mapování je pořád rozdělaná práce.
 *
 * `RUNNING` je „PRÁVĚ TEĎ se na tom pracuje" a jen podle něj se rozsvěcí odznak
 * v hlavičce. `paused` sem NEPATŘÍ, a je to celý smysl téhle dvojice:
 * `built-in-sources.ts` hlásí import čekající na člověka jako `paused` schválně,
 * aby odznak neukazoval úlohu, která sama nikdy neskončí, jenže tenhle výčet
 * ho pak zase započítal. Odznak tedy svítil „Běží 1 úloha" u importu, u kterého
 * se dva dny nic nedělo (naměřeno 7. 8. na `mlain_clean`), a odznak, který nejde
 * vynulovat, si člověk odvykne číst.
 *
 * Doslova totéž je v `packages/ui/src/patterns/jobs/types.ts`, protože seznam
 * dělí návrhový systém. Kdyby se rozešly, tvrdila by hlavička něco jiného
 * než obrazovka pod ní.
 */
export const UNFINISHED_JOB_STATUSES: readonly JobStatus[] = ['running', 'paused'];
export const RUNNING_JOB_STATUSES: readonly JobStatus[] = ['running'];

export type JobRecord = {
  id: string;
  /** Druh úlohy, zároveň klíč zdroje. Například `import` nebo `campaign_audience`. */
  kind: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  /** Zobrazované jméno toho, kdo úlohu spustil. U systémové úlohy null (5.7). */
  startedBy: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  note: string | null;
  /**
   * Jde tahle úloha zastavit PRÁVĚ TEĎ? Počítá si to zdroj ze svého stavu, ne
   * Centrum úloh z `status`: doběhlá úloha se zastavit nedá, ale nedá se ani
   * import, který zrovna počítá řádky souboru (přechod `validating → cancelled`
   * ve stavovém automatu importu není).
   *
   * Obrazovka podle toho tlačítko ZOBRAZÍ, nebo NEZOBRAZÍ. Zašedlé tlačítko bez
   * vysvětlení je v tomhle projektu vada, takže třetí možnost není.
   */
  cancellable: boolean;
  /**
   * Zrušení je vyžádané a běh ho ještě nemusel zaregistrovat.
   *
   * Zastavení je SPOLUPRÁCE, ne zabití: obě úlohy se na zrušení ptají až mezi
   * dávkami, takže mezi kliknutím a skutečným koncem uplyne čas rozpracované
   * dávky. Dokud tenhle příznak platí, rozhraní nesmí tvrdit „zastaveno".
   */
  stopping: boolean;
};

/**
 * Zrušení úlohy, pokud ho zdroj umí.
 *
 * Vlastní zastavení dělá DOMÉNA, ne Centrum úloh: import se ruší přepnutím
 * `imports.status`, stavba publika zrušením celé kampaně, a obojí má vlastní
 * podmíněný UPDATE, audit a oprávnění. Centrum jen ví, koho zavolat.
 */
export type JobCancel = {
  /** Oprávnění DOMÉNY, ne Centra úloh. Čtení seznamu smí i role, která ruší nesmí. */
  permission: Permission;
  run: (ctx: WorkspaceContext, id: string) => Promise<JobCancelOutcome>;
};

/**
 * Výsledek zrušení. Žádná z hodnot NENÍ chyba, a to schválně.
 *
 * Dvě kliknutí za sebou i kliknutí ve chvíli, kdy úloha zrovna doběhla, jsou
 * běžný provoz, ne selhání uživatele. Kdyby druhé kliknutí vrátilo 409, dostal
 * by člověk červenou hlášku za to, že mu první odpověď nestihla přijít.
 *
 *  - `cancelling`      zrušení právě zabralo, běh se zastaví u nejbližší kontroly
 *  - `already_cancelled` už bylo zrušené dřív, stav se nepřepisuje
 *  - `already_finished`  úloha skončila jinak, zpětně ji zrušit nelze
 */
export type JobCancelOutcome = 'cancelling' | 'already_cancelled' | 'already_finished';

/**
 * Kolik úloh a odkud. `before` je KURZOR, ne offset, a je to rozhodnutí.
 *
 * Offset by u slévaného seznamu nefungoval: zdroje se řadí až po slití, takže
 * `OFFSET 50` v každém z nich přeskočí padesátku VLASTNÍCH úloh, ne padesátku
 * z výsledku. Kurzor tenhle problém nemá, protože se řadí podle téhož sloupce,
 * podle kterého se ořezává. A druhá výhoda váží víc: mezi dvěma stránkami se
 * seznam hýbe (běžící import zapisuje každou dávku), takže by offset stránku
 * po stránce buď opakoval, nebo přeskakoval řádky.
 */
export type JobListOptions = {
  limit: number;
  /** Vrať jen úlohy změněné DŘÍV než tenhle okamžik. Chybí = od nejnovější. */
  before?: string;
};

export type JobSource = {
  kind: string;
  list: (ctx: WorkspaceContext, opts: JobListOptions) => Promise<JobRecord[]>;
  get: (ctx: WorkspaceContext, id: string) => Promise<JobRecord | null>;
  /**
   * Kolik úloh zdroj celkem má. Nepovinné: zdroj, který to nespočítá levně,
   * ho vynechá a jeho úlohy se v celkovém počtu neprojeví.
   *
   * Slouží stránkovací patičce tabulky („ukazujeme 50 ze 137"). Bez celku by
   * musela psát „50 z 50", tedy tvrdit, že za koncem stránky nic není, přesně
   * ve chvíli, kdy vedle svítí šipka na další stránku.
   */
  count?: (ctx: WorkspaceContext) => Promise<number>;
  /** Zdroj bez tohohle pole úlohy zastavit neumí a Centrum u nich tlačítko nenabídne. */
  cancel?: JobCancel;
};

/**
 * Registr zdrojů úloh.
 *
 * P04 vlastní API a mechanismus, ale NEZNÁ doménové tabulky postupu: `imports`
 * vlastní P11, `campaign_audience_progress` vlastní P13. Generická tabulka úloh
 * ve schématu záměrně není. Každá doména si proto svůj zdroj zaregistruje sama,
 * stejně jako se u P03 registrují repository moduly.
 *
 * Registr je po doběhnutí P04 PRÁZDNÝ a endpoint vrací prázdný seznam. Je to
 * správný stav: žádná úloha z P04 netrvá tak dlouho, aby patřila do Centra úloh.
 */
const sources = new Map<string, JobSource>();

export function registerJobSource(source: JobSource): void {
  if (sources.has(source.kind)) {
    // Tvrdě. Tiché přepsání by znamenalo, že jeden ze dvou plánů dodal zdroj,
    // který se nikdy nezavolá, a jeho úlohy by v Centru chyběly bez chyby.
    throw new Error(`Zdroj úloh pro druh "${source.kind}" je už zaregistrovaný.`);
  }
  sources.set(source.kind, source);
}

export function registeredJobKinds(): string[] {
  return [...sources.keys()].sort();
}

/**
 * Zdroj podle druhu. Existuje kvůli testům, které potřebují ověřit chování
 * zdroje v okamžiku závodu, tedy když se stav změní mezi čtením a zápisem.
 * Ten okamžik se přes HTTP nedá spolehlivě trefit, přes zdroj ano.
 */
export function jobSourceFor(kind: string): JobSource | null {
  return sources.get(kind) ?? null;
}

/** Jen pro testy. Produkční kód registruje zdroje jednou při startu. */
export function clearJobSources(): void {
  sources.clear();
}

/**
 * Slije úlohy ze všech zdrojů, seřadí od nejnovější změny a ořízne na limit.
 *
 * Limit se uplatňuje AŽ PO SLITÍ. Kdyby si ho každý zdroj ořezával sám, dva
 * zdroje s limitem 20 by vrátily 40 řádků a pořadí by přestalo platit.
 * Zdrojům se proto předává tentýž limit jen jako strop jejich vlastního dotazu.
 *
 * Pád jednoho zdroje ostatní nezahazuje: Centrum úloh je diagnostická
 * obrazovka a je nejužitečnější přesně tehdy, když je něco rozbité.
 */
export async function listJobs(ctx: WorkspaceContext, opts: JobListOptions): Promise<JobRecord[]> {
  const settled = await Promise.allSettled([...sources.values()].map((s) => s.list(ctx, opts)));
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return all
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, opts.limit);
}

/**
 * Kolik úloh má projekt celkem, přes všechny zdroje.
 *
 * Pád jednoho zdroje ostatní nezahazuje, stejně jako u `listJobs`: celek
 * o kus menší je pořád použitelnější než rozbitá obrazovka, a Centrum úloh
 * je nejvíc potřeba právě tehdy, když je něco rozbité.
 */
export async function countJobs(ctx: WorkspaceContext): Promise<number> {
  const counters = [...sources.values()].filter((source) => source.count !== undefined);
  const settled = await Promise.allSettled(counters.map((source) => source.count!(ctx)));
  return settled.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
}

export async function getJob(
  ctx: WorkspaceContext,
  kind: string,
  id: string,
): Promise<JobRecord | null> {
  const source = sources.get(kind);
  if (!source) return null;
  return source.get(ctx, id);
}

export type CancelJobResult =
  /** Neznámý druh i neznámé ID. Volající z toho dělá 404, aby druhy nešly ohmatat. */
  | { status: 'not_found' }
  /** Druh úlohy zastavit neumí. Tlačítko se u něj nezobrazuje, cesta přesto odpovídá. */
  | { status: 'unsupported'; job: JobRecord }
  | { status: 'done'; outcome: JobCancelOutcome; job: JobRecord };

/**
 * Zrušení úlohy jedním vstupem pro celé Centrum úloh.
 *
 * OPRÁVNĚNÍ SE OVĚŘUJE PŘES `assert`, ne uvnitř. Registr nesmí záviset na
 * identitě (jinak vznikne kruh přes `identity/api`), ale zároveň se nesmí stát,
 * že Centrum úloh obejde doménové oprávnění: `contacts:import` a
 * `campaigns:control` má míň rolí než `timeline:read`, kterým se seznam čte.
 * Callback proto POVINNĚ dodává volající a zavolá se DŘÍV, než se cokoli změní.
 *
 * Stav se čte i po zásahu, aby odpověď nesla úlohu tak, jak vypadá TEĎ. Bez
 * toho by obrazovka po kliknutí musela hádat, co se stalo, nebo si vymýšlet
 * mezistav.
 */
export async function cancelJob(
  ctx: WorkspaceContext,
  kind: string,
  id: string,
  opts: { assert: (permission: Permission) => void },
): Promise<CancelJobResult> {
  const source = sources.get(kind);
  if (!source) return { status: 'not_found' };
  const job = await source.get(ctx, id);
  if (!job) return { status: 'not_found' };
  if (!source.cancel) return { status: 'unsupported', job };

  opts.assert(source.cancel.permission);

  // Úloha, která už zastavit nejde, se doméně vůbec nepředává: doběhlý import
  // by z ní dostal 409 a Centrum by z něj muselo zpětně luštit, co se stalo.
  // Rozhodnutí ale nestojí NA TOMHLE čtení: doménový UPDATE má vlastní podmínku
  // stavu, takže úloha, která doběhne mezi čtením a zápisem, konečný stav
  // nepřepíše a vrátí se jako `already_finished`.
  if (!job.cancellable) {
    return {
      status: 'done',
      outcome: job.status === 'cancelled' ? 'already_cancelled' : 'already_finished',
      job,
    };
  }

  const outcome = await source.cancel.run(ctx, id);
  const after = await source.get(ctx, id);
  return { status: 'done', outcome, job: after ?? job };
}

/**
 * Počet BĚŽÍCÍCH úloh pro odznak v topbaru. Dokončené ani pozastavené odznak
 * nedělají: pozastavená úloha čeká na člověka, ne na worker, takže by odznak
 * svítil, dokud se jí někdo nevěnuje, a to může být navždy.
 */
export async function runningJobCount(ctx: WorkspaceContext): Promise<number> {
  const jobs = await listJobs(ctx, { limit: 200 });
  return jobs.filter((j) => RUNNING_JOB_STATUSES.includes(j.status)).length;
}
