import { desc, eq, gte, sql } from 'drizzle-orm';
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
