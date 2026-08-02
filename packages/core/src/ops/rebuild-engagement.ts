import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/db';
import { withAdminTx } from './db';

export type RebuildInput = {
  /**
   * `DATABASE_URL_MIGRATOR`. `contacts`, `contact_engagement`
   * i `message_engagement` mají `ws_isolation`, takže pod aplikační rolí
   * by přepočet prošel, zpracoval nula kontaktů a ohlásil hotovo.
   */
  adminUrl: string;
  workspaceId: string;
  batchSize?: number;
  onProgress?: (processed: number) => void;
};

export type RebuildReport = { processed: number; batches: number };

type RecomputeFn = (
  tx: Tx,
  input: { workspaceId: string; batchSize: number; cursor: string | null },
) => Promise<{ processed: number; nextCursor: string | null }>;

/**
 * Přepočet z domény trackingu. Načítá se dynamicky, a je to VĚDOMÉ.
 *
 * Rozhraní I→P10.1 slibuje `recomputeContactEngagement(tx, { workspaceId,
 * batchSize, cursor })` v `@mlain/core/tracking`. Ta funkce už existuje
 * (`tracking/repo/contact-engagement.repo.ts`), dynamický import ale zůstává:
 * statický by přitáhl celý barrel domény trackingu do barelu `@mlain/core/ops`,
 * takže by případná chyba při načítání trackingu shodila i `mlain doctor`,
 * `mlain backup` a `mlain restore`. Kontrolu tvaru dělá `loadRecompute` níž
 * a hlásí ji jménem, ne obecným pádem.
 *
 * Vlastní vzorec se tu SCHVÁLNĚ neopisuje (rozhodnutí A8): dvě implementace
 * téhož agregátu se rozejdou a rozdíl se pozná až na číslech u zákazníka.
 * Kritérium 77 části 5 se dá doložit jen tehdy, když je vzorec jeden.
 */
async function loadRecompute(): Promise<RecomputeFn> {
  const tracking = (await import('../tracking/index')) as Record<string, unknown>;
  const fn = tracking['recomputeContactEngagement'];
  if (typeof fn !== 'function') {
    throw new Error(
      'Přepočet zapojení nejde spustit: @mlain/core/tracking neexportuje ' +
        'recomputeContactEngagement(tx, { workspaceId, batchSize, cursor }). ' +
        'Tuhle funkci vlastní část 5 (rozhraní I→P10.1) a P16 ji schválně ' +
        'neimplementuje podruhé: dvě kopie téhož vzorce se rozejdou a rozdíl ' +
        'se pozná až na číslech u zákazníka.',
    );
  }
  return fn as RecomputeFn;
}

/**
 * Přepočítá contact_engagement od nuly. Vzorec vlastní část 5 a tenhle modul
 * ho **neopisuje**: dvě implementace téhož agregátu se rozejdou a rozdíl se
 * pozná až na číslech u zákazníka. Tady je jen dávkování, aby přepočet
 * pěti milionů kontaktů nezastavil provoz.
 *
 * Každá dávka má vlastní transakci schválně: přepočet nad milionem kontaktů
 * by v jedné transakci držel zámky hodiny a zablokoval provoz. Přerušený běh
 * se dokončí opakovaným spuštěním, protože `recomputeContactEngagement`
 * počítá stav z dat, ne z rozdílu.
 */
export async function rebuildEngagement(input: RebuildInput): Promise<RebuildReport> {
  const batchSize = input.batchSize ?? 5000;

  const exists = await withAdminTx(input.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM workspaces
           WHERE id = ${input.workspaceId} AND deleted_at IS NULL`,
    );
    return rows.length > 0;
  });
  if (!exists) {
    throw new Error(
      `Projekt ${input.workspaceId} neexistuje. Přepočet se nespustil, aby se nulový výsledek ` +
        'nedal splést s hotovou prací.',
    );
  }

  const recompute = await loadRecompute();

  let cursor: string | null = null;
  let processed = 0;
  let batches = 0;

  for (;;) {
    const result = await withAdminTx(input.adminUrl, (tx) =>
      recompute(tx, {
        workspaceId: input.workspaceId,
        batchSize,
        cursor,
      }),
    );
    processed += result.processed;
    batches += 1;
    input.onProgress?.(processed);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }

  return { processed, batches };
}
