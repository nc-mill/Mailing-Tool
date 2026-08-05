import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../../tx';

/**
 * Jediné místo, které sahá na `brand_extractions`.
 *
 * Ven z aplikace nikdy nejde syrový řádek: `hop_summary`, počet stažených bajtů
 * ani cokoliv, z čeho by šla odvodit IP adresa cílového serveru, se neposílá
 * (kritérium 53). Filtruje to `toPublicExtraction`, ne volající.
 */
export type ExtractionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked';

export type ExtractionRow = {
  id: string;
  /**
   * Projekt, kterému řádek patří. Nevybírá se proto, aby se jím dalo filtrovat
   * (to dělá RLS), ale proto, aby job mohl ověřit, že náklad úlohy míří tam,
   * kde ho zpracovává. Do veřejného tvaru nejde, `toPublicExtraction` skládá
   * odpověď po polích.
   */
  workspaceId: string;
  inputUrl: string;
  normalizedUrl: string;
  status: ExtractionStatus;
  errorCode: string | null;
  result: unknown;
  brandProfileId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/** Tvar, který smí ven přes API a do prohlížeče. */
export type PublicExtraction = {
  id: string;
  status: ExtractionStatus;
  error_code: string | null;
  brand_profile_id: string | null;
  result: { warnings?: string[] } | null;
};

const COLUMNS = {
  id: schema.brandExtractions.id,
  workspaceId: schema.brandExtractions.workspaceId,
  inputUrl: schema.brandExtractions.inputUrl,
  normalizedUrl: schema.brandExtractions.normalizedUrl,
  status: schema.brandExtractions.status,
  errorCode: schema.brandExtractions.errorCode,
  result: schema.brandExtractions.result,
  brandProfileId: schema.brandExtractions.brandProfileId,
  createdAt: schema.brandExtractions.createdAt,
  finishedAt: schema.brandExtractions.finishedAt,
} as const;

function toRow(row: {
  id: string;
  workspaceId: string;
  inputUrl: string;
  normalizedUrl: string;
  status: string;
  errorCode: string | null;
  result: unknown;
  brandProfileId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): ExtractionRow {
  return { ...row, status: row.status as ExtractionStatus };
}

export async function findExtraction(tx: Tx, extractionId: string): Promise<ExtractionRow | null> {
  const rows = await tx
    .select(COLUMNS)
    .from(schema.brandExtractions)
    .where(eq(schema.brandExtractions.id, extractionId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export async function listRecentExtractions(tx: Tx, limit: number): Promise<ExtractionRow[]> {
  const rows = await tx
    .select(COLUMNS)
    .from(schema.brandExtractions)
    .orderBy(desc(schema.brandExtractions.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

/**
 * Jeden řádek historie stažení pro obrazovku Nastavení → Značka projektu.
 *
 * Je to HISTORIE BĚHŮ, ne seznam značek. Značku má projekt jednu a každé
 * stažení ji přepíše; tenhle seznam odpovídá na otázku „co a kdy jsme z webu
 * vytáhli", ne „mezi čím můžu přepínat".
 *
 * Ven jde totéž, co přes `toPublicExtraction`, plus barvy z běhu a časy.
 * `hop_summary` ani počet bajtů se nevydávají ani tady (kritérium 53).
 */
export type BrandExtractionHistoryItem = {
  id: string;
  url: string;
  status: ExtractionStatus;
  errorCode: string | null;
  warnings: string[];
  /** Barvy, které běh vytáhl. `null` u běhů, které nedoběhly, a u starších záznamů. */
  palette: Record<string, string> | null;
  createdAt: string;
  finishedAt: string | null;
};

function historyWarnings(result: unknown): string[] {
  const warnings = (result as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((item): item is string => typeof item === 'string');
}

/**
 * Paleta z `result`. Bere se jen pět barev v šestimístném hex tvaru: `source`
 * (odkud se která barva vzala) je podrobnost o cizím webu a do historie
 * nepatří.
 */
function historyPalette(result: unknown): Record<string, string> | null {
  const palette = (result as { palette?: unknown } | null)?.palette;
  if (typeof palette !== 'object' || palette === null) return null;
  const picked: Record<string, string> = {};
  for (const role of ['primary', 'secondary', 'accent', 'background', 'text']) {
    const value = (palette as Record<string, unknown>)[role];
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) picked[role] = value;
  }
  return Object.keys(picked).length === 0 ? null : picked;
}

export function toHistoryItem(row: ExtractionRow): BrandExtractionHistoryItem {
  return {
    id: row.id,
    url: row.normalizedUrl,
    status: row.status,
    errorCode: row.errorCode,
    warnings: historyWarnings(row.result),
    palette: historyPalette(row.result),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
  };
}

/** Historie stažení projektu, nejnovější první. */
export async function listBrandExtractionHistory(
  tx: Tx,
  limit: number,
): Promise<BrandExtractionHistoryItem[]> {
  const rows = await listRecentExtractions(tx, limit);
  return rows.map(toHistoryItem);
}

/**
 * Kolik pokusů projekt udělal za poslední hodinu. Počítá se nad indexem
 * `idx_brand_extractions__workspace_created` z P03, aby limit „deset za hodinu"
 * (kritérium 54) nestál na sekvenčním průchodu tabulkou.
 */
export async function countExtractionsInLastHour(tx: Tx): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.brandExtractions)
    .where(gte(schema.brandExtractions.createdAt, since));
  return rows[0]?.count ?? 0;
}

/**
 * Kolik běhů projektu právě probíhá.
 *
 * `pending` se počítá spolu s `running`: úloha zařazená do fronty ještě
 * nezačala stahovat, ale místo v souběhu už zabírá. Kdyby se počítalo jen
 * `running`, prošlo by libovolně mnoho žádostí, dokud si je worker nestihne
 * převzít, a strop `BRAND_FETCH_CONCURRENCY` by neplatil právě ve chvíli,
 * kdy na něm záleží (někdo mačká tlačítko dokola).
 *
 * Projekt vybírá RLS, stejně jako u `countExtractionsInLastHour`.
 */
export async function countRunningExtractions(tx: Tx): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.brandExtractions)
    .where(inArray(schema.brandExtractions.status, ['pending', 'running']));
  return rows[0]?.count ?? 0;
}

export type NewExtraction = {
  /**
   * Vyplňuje se, přestože projekt vybírá RLS: sloupec je NOT NULL bez DEFAULT,
   * takže vynechání skončí chybou 23502, ne tichým doplněním z kontextu.
   * Týž důvod jako u `insertBrandProfile`.
   */
  workspaceId: string;
  /** `null` u aktéra, který není uživatel (klíč k API). Sloupec cizí klíč povoluje. */
  requestedBy: string | null;
  inputUrl: string;
  normalizedUrl: string;
  status: ExtractionStatus;
};

/**
 * Založení běhu. Volá se z HTTP vrstvy v TÉŽE transakci jako zařazení úlohy do
 * fronty a zápis do audit logu: kdyby se transakce rollbackla, nesmí zůstat ani
 * řádek bez úlohy, ani úloha bez řádku.
 */
export async function insertExtraction(
  tx: Tx,
  row: NewExtraction,
): Promise<{ id: string; status: ExtractionStatus }> {
  const inserted = await tx
    .insert(schema.brandExtractions)
    .values({
      workspaceId: row.workspaceId,
      requestedBy: row.requestedBy,
      inputUrl: row.inputUrl,
      normalizedUrl: row.normalizedUrl,
      status: row.status,
    })
    .returning({ id: schema.brandExtractions.id, status: schema.brandExtractions.status });
  const created = inserted[0]!;
  return { id: created.id, status: created.status as ExtractionStatus };
}

/**
 * Převzetí běhu jobem. Podmínka na `pending` je v dotazu, ne jen v
 * `assertTransition` na straně jobu: pg-boss doručí úlohu i podruhé, když
 * worker spadne po převzetí a před potvrzením, a dvě souběžná stahování téhož
 * webu by si přepsala výsledek. Kdo řádek nepřevzal, dostane `false` a nemá
 * pokračovat.
 */
export async function markRunning(tx: Tx, extractionId: string): Promise<boolean> {
  const updated = await tx
    .update(schema.brandExtractions)
    .set({ status: 'running' })
    .where(
      and(
        eq(schema.brandExtractions.id, extractionId),
        eq(schema.brandExtractions.status, 'pending'),
      ),
    )
    .returning({ id: schema.brandExtractions.id });
  return updated.length > 0;
}

export type FinishExtractionInput = {
  id: string;
  status: ExtractionStatus;
  errorCode: string | null;
  /** Jen třída adresy, nikdy syrová IP. Skládá ho `safeFetch`, ne tenhle modul. */
  hopSummary: unknown;
  bytesFetched: number;
  durationMs: number;
  result: unknown;
  brandProfileId: string | null;
};

/**
 * Koncový zápis. Stav se mění jen z `running`, protože koncový stav se podle
 * `assertTransition` nikdy nepřepisuje: opakovaný pokus zakládá nový řádek.
 */
export async function finishExtraction(tx: Tx, input: FinishExtractionInput): Promise<void> {
  await tx
    .update(schema.brandExtractions)
    .set({
      status: input.status,
      errorCode: input.errorCode,
      hopSummary: input.hopSummary as never,
      bytesFetched: input.bytesFetched,
      durationMs: input.durationMs,
      result: input.result as never,
      brandProfileId: input.brandProfileId,
      finishedAt: new Date(),
    })
    .where(
      and(eq(schema.brandExtractions.id, input.id), eq(schema.brandExtractions.status, 'running')),
    );
}

/**
 * Úklid po pádu workeru: běh zaseknutý v `running` se po limitu uzavře.
 *
 * Mezníkem je `created_at`, protože tabulka nemá sloupec s časem převzetí
 * (schéma vlastní P03 a je zmrazené). U fronty s `retryLimit: 0` a expirací
 * pět minut je rozdíl mezi založením a převzetím zanedbatelný.
 */
export async function failStaleExtractions(
  tx: Tx,
  cutoff: Date,
  errorCode: string,
): Promise<number> {
  const updated = await tx
    .update(schema.brandExtractions)
    .set({ status: 'failed', errorCode, finishedAt: new Date() })
    .where(
      and(
        eq(schema.brandExtractions.status, 'running'),
        lt(schema.brandExtractions.createdAt, cutoff),
      ),
    )
    .returning({ id: schema.brandExtractions.id });
  return updated.length;
}

/**
 * Veřejný tvar. Z `result` projde jen seznam varování; celý objekt nese
 * i technické podrobnosti o stažení, které uživateli nic neřeknou a útočníkovi
 * napoví, kam jsme se dostali a kam ne.
 */
export function toPublicExtraction(row: ExtractionRow): PublicExtraction {
  const warnings = (row.result as { warnings?: unknown } | null)?.warnings;
  return {
    id: row.id,
    status: row.status,
    error_code: row.errorCode,
    brand_profile_id: row.brandProfileId,
    result: Array.isArray(warnings)
      ? { warnings: warnings.filter((item): item is string => typeof item === 'string') }
      : null,
  };
}
