import 'server-only';
import {
  PRICING_UPDATED_AT,
  aiRepo,
  buildUsageReport,
  toPublicCredential,
  type PublicCredential,
  type UsageReport,
} from '@mlain/core/ai';
import { listBrandProfiles, type BrandProfileSummary } from '@mlain/core/brand';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { withReadOnly } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity/types';

/**
 * Serverové komponenty čtou přímo, ne přes REST: endpoint by znamenal další
 * kolo po síti pro data, která má proces k dispozici. Zápis jde naopak vždy
 * přes API, protože ho používá i asistent.
 *
 * `withReadOnly` bere (ctx, options, fn), tedy tři parametry. Dvouparametrová
 * varianta je `withWorkspace`.
 */
const READ_ONLY = { statementTimeoutMs: 5_000 } as const;

export type { PublicCredential, UsageReport, BrandProfileSummary };

/**
 * Kontext projektu se nedá složit z řetězce, typ je branded. Jediná legitimní
 * továrna je `createWorkspaceContext`, která zároveň ověří členství: nečlen
 * dostane `not_found`, ne `forbidden`.
 */
export function aiWorkspaceContext(input: {
  userId: string;
  workspaceSlug: string;
}): Promise<WorkspaceContext> {
  return createWorkspaceContext({
    kind: 'session',
    userId: input.userId,
    workspaceRef: input.workspaceSlug,
  });
}

/**
 * Klíče projektu ve veřejném tvaru. Sloupec s obálkou se do výsledku
 * nedostane: `toPublicCredential` vydává jen `key_hint` o čtyřech znacích
 * (kritérium 66).
 */
export async function fetchCredentials(ctx: WorkspaceContext): Promise<PublicCredential[]> {
  const rows = await withReadOnly(ctx, READ_ONLY, (tx) => aiRepo.listCredentials(tx));
  return rows.map((row) => toPublicCredential(row));
}

function dayString(offsetDays: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - offsetDays);
  return day.toISOString().slice(0, 10);
}

/**
 * Spotřeba za posledních `days` dní. Peníze se dopočítávají z ceníku a u modelu
 * mimo ceník zůstanou `null`, aby se uživateli o cenách nelhalo (rozhodnutí D2).
 */
export async function fetchUsage(ctx: WorkspaceContext, days: number): Promise<UsageReport> {
  const to = dayString(0);
  const from = dayString(Math.max(days - 1, 0));
  const rows = await withReadOnly(ctx, READ_ONLY, (tx) => aiRepo.loadUsageRows(tx, { from, to }));
  return buildUsageReport(rows, { from, to });
}

export async function fetchBrandProfiles(ctx: WorkspaceContext): Promise<BrandProfileSummary[]> {
  return withReadOnly(ctx, READ_ONLY, (tx) => listBrandProfiles(tx));
}

export { PRICING_UPDATED_AT };
