/**
 * Kanonický otisk odkazu na pole.
 *
 * PROČ NESTAČÍ `JSON.stringify`. Definice segmentu leží v `segments.definition`
 * typu `jsonb` a Postgres v jsonb klíče objektu PŘEROVNÁ (nejdřív podle délky,
 * pak bajtově). Katalog polí staví `{ kind, key }`, jenže z databáze se vrátí
 * `{"key":"status","kind":"contact"}`. Prosté porovnání dvou `JSON.stringify`
 * se proto u ULOŽENÉHO segmentu nikdy netrefilo a výběr pole u každé podmínky
 * zůstal prázdný, přestože segment počítal správně. Uživatel viděl podmínku
 * bez pole, bez operátoru a bez hodnoty, tedy „prostě to nefunguje".
 *
 * Otisk proto klíče seřadí sám, rekurzivně, a je nezávislý na pořadí.
 */
export function fieldRefKey(ref: unknown): string {
  if (Array.isArray(ref)) return `[${ref.map(fieldRefKey).join(',')}]`;
  if (ref !== null && typeof ref === 'object') {
    const entries = Object.entries(ref as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${fieldRefKey(value)}`).join(',')}}`;
  }
  return JSON.stringify(ref) ?? 'null';
}
