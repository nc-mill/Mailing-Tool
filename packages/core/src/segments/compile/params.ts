import { sql, type SQL } from 'drizzle-orm';

/**
 * Jediná cesta, jak se hodnota dostane do dotazu. Kdo potřebuje hodnotu v SQL,
 * zavolá `add()` a dostane placeholder. Interpolace hodnoty do textu dotazu je
 * v tomhle modulu chyba, na kterou existuje sada invariantů nad textem dotazu.
 */
export class ParamBag {
  readonly values: unknown[] = [];

  constructor(private readonly offset: number) {}

  add(value: unknown, cast?: string): string {
    this.values.push(value);
    const index = this.offset + this.values.length;
    return cast ? `$${index}::${cast}` : `$${index}`;
  }

  /** Placeholder už přidané hodnoty. Používá se pro workspace_id, asOf a zónu. */
  ref(index1Based: number, cast?: string): string {
    const index = this.offset + index1Based;
    return cast ? `$${index}::${cast}` : `$${index}`;
  }
}

const PLACEHOLDER = /\$(\d+)/g;

/**
 * Převede `{ sql, params }` z kompilátoru na drizzle `SQL`, protože `Tx` je
 * drizzle handle a jeho `execute()` bere JEDEN argument, ne dvojici (text, params).
 * Tohle je jediné místo, kde ten převod je.
 *
 * Dvě věci, které se nedají odvodit čtením a jsou ověřené spuštěním:
 *
 *  1. Hodnota se MUSÍ předat přes `sql.param()`. Holé pole v šabloně `sql` se
 *     rozloží na jednotlivé parametry, takže `= ANY(${values})` vyrobí
 *     `ANY(($1, $2, $3))` a dotaz spadne na `42809 op ANY/ALL (array) requires
 *     array on right side`. Se `sql.param()` vznikne `ANY($1)` s jedním polem.
 *  2. Text se MUSÍ vkládat přes `sql.raw()`. Řetězec vložený přímo do šablony
 *     by se stal parametrem, ne částí dotazu.
 *
 * Opakovaný odkaz (`$2` je asOf a je v dotazu mnohokrát) se naváže tolikrát,
 * kolikrát se vyskytne, vždy s toutéž hodnotou. Drizzle si parametry čísluje samo,
 * takže výsledná čísla se od vstupních liší; podstatné je párování hodnot, ne čísla.
 *
 * Text kompilátoru neobsahuje uživatelské řetězce (hlídá to sada invariantů),
 * takže v něm nemůže být `$` uvnitř literálu a hledání placeholderů je bezpečné.
 */
export function toSql(text: string, params: readonly unknown[]): SQL {
  const chunks: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = Number(match[1]);
    if (index < 1 || index > params.length) {
      throw new Error(`placeholder $${index} has no value (${params.length} params given)`);
    }
    if (match.index > last) chunks.push(sql.raw(text.slice(last, match.index)));
    chunks.push(sql`${sql.param(params[index - 1])}`);
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push(sql.raw(text.slice(last)));
  return sql.join(chunks);
}
