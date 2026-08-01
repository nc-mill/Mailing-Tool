import { sql, type SQL, type SQLChunk } from 'drizzle-orm';

/**
 * Nese normativní SQL text s pozičními parametry k Drizzle handle.
 *
 * Existuje ze tří důvodů a každý z nich je ověřený spuštěním.
 *
 * 1. `Tx` z `../../tx` je `NodePgDatabase`. Jeho `query` je relační dotazovací
 *    API Drizzle, tedy OBJEKT, ne funkce; `tx.query(text, params)` padá s
 *    `tx.query is not a function`. Syrový text se tedy k databázi musí dostat jinudy.
 * 2. `sql.raw(text)` parametry nést neumí a slepené hodnoty do textu jsou injekce.
 * 3. Holá hodnota typu pole se v šabloně `sql` rozloží na jednotlivé parametry, takže
 *    `sql`SELECT ... ${ids}::uuid[]`` vygeneruje `($1, $2, $3)::uuid[]` a dotaz spadne
 *    při prvním použití. Hodnoty proto jdou výhradně přes `sql.param`.
 *
 * Rozhodnutí D3 vyžaduje, aby text dotazu zůstal doslova takový, jaký je ve specifikaci,
 * protože scénář `OB-00` porovnává specifikaci s kódem. Tahle funkce to drží: text se
 * nemění, jen se v něm `$n` nahradí vázaným parametrem.
 */
export function rawSql(text: string, params: readonly unknown[] = []): SQL {
  // Rozdeleni zachova text beze zmeny; liche prvky jsou cisla parametru.
  const parts = text.split(/\$(\d+)/g);
  // `SQLChunk`, ne `SQL[]`: `sql.param()` vraci `Param`, ktery `SQL` NENI.
  // S uzsim typem se soubor nezkompiluje.
  const chunks: SQLChunk[] = [sql.raw(parts[0] ?? '')];

  for (let i = 1; i < parts.length; i += 2) {
    const ordinal = Number(parts[i]);
    const index = ordinal - 1;
    if (!Number.isInteger(ordinal) || index < 0 || index >= params.length) {
      throw new Error(
        `rawSql: dotaz odkazuje na $${parts[i]}, ale dostal jen ${params.length} parametrů. ` +
          `Text: ${text.slice(0, 120)}`,
      );
    }
    chunks.push(sql.param(params[index]));
    chunks.push(sql.raw(parts[i + 1] ?? ''));
  }

  return sql.join(chunks, sql.raw(''));
}
