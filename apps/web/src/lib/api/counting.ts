import { sql, type SQL } from 'drizzle-orm';
import { pgErrorCode, withoutContext, type Tx } from '@mlain/core/tx';

/** 4.3: přesný COUNT(*) se počítá se statement_timeout 500 ms, pak se vrací odhad. */
export const COUNT_TIMEOUT_MS = 500;

/** SQLSTATE pro dotaz zrušený kvůli statement_timeout. */
const QUERY_CANCELED = '57014';

export type CountResult = {
  count: number;
  precision: 'exact' | 'estimated';
  computed_at: string;
  stale: boolean;
};

/**
 * Spustí přesný COUNT(*) se stropem. Když nedoběhne, vrátí odhad plánovače.
 * Drtivá většina instalací dostane přesné číslo a nikdo nečeká déle než půl sekundy.
 *
 * Odhad běží ve VLASTNÍ transakci schválně: po zrušeném dotazu je původní
 * transakce v chybovém stavu a další příkaz v ní by skončil na 25P02.
 */
export async function countWithTimeout(
  tx: Tx,
  exactQuery: SQL,
  estimateQuery: SQL,
): Promise<CountResult> {
  const computedAt = new Date().toISOString();
  try {
    // SET LOCAL platí do konce transakce, takže se strop nepropíše do dalších dotazů.
    //
    // `sql.raw` je tu POVINNÉ, ne kosmetika. `SET LOCAL` nejde parametrizovat
    // a Drizzle by z `${COUNT_TIMEOUT_MS}` udělal vazbu `$1`; ověřeno spuštěním,
    // PostgreSQL na to odpoví `42601 syntax error at or near "$1"`. Je to tentýž
    // důvod, kvůli kterému P03 kontroluje tvar `work_mem` regulárním výrazem.
    // Injekce tu nehrozí: hodnota je konstanta modulu proletěná přes Math.trunc.
    await tx.execute(
      sql`SET LOCAL statement_timeout = ${sql.raw(String(Math.trunc(COUNT_TIMEOUT_MS)))}`,
    );
    const { rows } = await tx.execute<{ count: string | number }>(exactQuery);
    await tx.execute(sql`SET LOCAL statement_timeout = DEFAULT`);
    return {
      count: Number(rows[0]?.count ?? 0),
      precision: 'exact',
      computed_at: computedAt,
      stale: false,
    };
  } catch (err) {
    // SQLSTATE se čte VÝHRADNĚ přes pgErrorCode. Drizzle chybu ovladače balí
    // do DrizzleQueryError, takže `err.code` je undefined a přímé porovnání by
    // bylo vždy nepravda: náhradní cesta na odhad by se nikdy neprovedla
    // a uživatel by místo přibližného čísla dostal 500. Ověřeno spuštěním, viz 0.8.
    if (pgErrorCode(err) !== QUERY_CANCELED) throw err;
    const rows = await withoutContext(
      async (fresh) => (await fresh.execute<{ count: string | number }>(estimateQuery)).rows,
    );
    return {
      count: Number(rows[0]?.count ?? 0),
      precision: 'estimated',
      computed_at: computedAt,
      stale: false,
    };
  }
}

/** Odhad plánovače pro nefiltrovaný seznam: reltuples z pg_class. */
export function reltuplesEstimate(tableName: string): SQL {
  return sql`SELECT GREATEST(reltuples, 0)::bigint AS count FROM pg_class WHERE oid = ${tableName}::regclass`;
}
