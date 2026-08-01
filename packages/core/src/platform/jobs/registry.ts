import type { WorkspaceContext } from '@mlain/db';

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

export const RUNNING_JOB_STATUSES: readonly JobStatus[] = ['running', 'paused'];

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
};

export type JobSource = {
  kind: string;
  list: (ctx: WorkspaceContext, opts: { limit: number }) => Promise<JobRecord[]>;
  get: (ctx: WorkspaceContext, id: string) => Promise<JobRecord | null>;
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
export async function listJobs(
  ctx: WorkspaceContext,
  opts: { limit: number },
): Promise<JobRecord[]> {
  const settled = await Promise.allSettled([...sources.values()].map((s) => s.list(ctx, opts)));
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return all
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, opts.limit);
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

/** Počet běžících úloh pro odznak v topbaru. Dokončené odznak nedělají. */
export async function runningJobCount(ctx: WorkspaceContext): Promise<number> {
  const jobs = await listJobs(ctx, { limit: 200 });
  return jobs.filter((j) => RUNNING_JOB_STATUSES.includes(j.status)).length;
}
