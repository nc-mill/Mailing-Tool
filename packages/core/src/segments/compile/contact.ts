import type { ContactFieldKey, Operator } from '../ast';
import { contactFieldClass } from '../operators';
import type { ParamBag } from './params';
import { contactColumnSql } from './columns';

/** Escapuje `%` a `_`, aby hodnota od uživatele nebyla zástupným znakem. */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

type Node = { value?: unknown; values?: unknown[] | undefined };
type Field = { kind: 'contact'; key: ContactFieldKey };

/**
 * `asOf` se odkazuje VŽDY s explicitním `::timestamptz` a nikdy holé `$2`.
 *
 * Není to kosmetika a nedá se to odvodit čtením: typ parametru se odvozuje
 * z okolí a ve výrazu `sloupec >= $2 - make_interval(days => $4)` PostgreSQL
 * vyhodnotí odčítání dřív, odvodí `$2` jako `interval` a dotaz skončí chybou
 * `42883 operator does not exist: timestamp with time zone >= interval`.
 * Když se parametr pošle jako `Date`, spadne to už dřív na
 * `22007 invalid input syntax for type interval`.
 *
 * Zrádné je, že to selže jen někdy: v `$2 > sloupec` typ určí levá strana
 * a projde to. Segment „registrovali se za posledních 30 dní" by tedy spadl,
 * zatímco „registrovali se po datu" ne, a rozdíl by nikdo nespojil
 * s chybějícím castem.
 */
const ASOF_CAST = 'timestamptz';

/**
 * Prvotřídní pole jsou tříhodnotová z podstaty: porovnání s NULL sloupcem vrací
 * v SQL NULL, tedy „neznámo". Skládání skupin i negace s tím počítají a
 * `WHERE` na konci neznámo vyřadí, takže `NOT` nad neznámou hodnotou nikdy
 * nevyjde jako `true`. Jediné dva totální operátory jsou `is_empty`
 * a `is_not_empty`, protože ty se ptají právě na přítomnost hodnoty.
 */
export function compileContactCondition(
  alias: string,
  field: Field,
  operator: Operator,
  node: Node,
  bag: ParamBag,
): string {
  const col = contactColumnSql(alias, field.key);
  const asOf = bag.ref(2, ASOF_CAST);
  const cls = contactFieldClass(field.key);

  switch (operator) {
    case 'eq':
      return `(${col} = ${bag.add(node.value)})`;
    case 'neq':
      return `(${col} <> ${bag.add(node.value)})`;
    case 'contains':
      return `(${col} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'not_contains':
      return `(${col} NOT ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'starts_with':
      return `(${col} ILIKE ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'ends_with':
      return `(${col} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))})`;
    case 'in':
      return `(${col} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')}))`;
    case 'not_in':
      return `(NOT (${col} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')})))`;
    case 'is_empty':
      return `(${col} IS NULL OR ${col}::text = '')`;
    case 'is_not_empty':
      return `(${col} IS NOT NULL AND ${col}::text <> '')`;
    case 'is_true':
      return `(${col} = true)`;
    case 'is_false':
      return `(${col} = false)`;
    case 'gt':
      return `(${col} > ${bag.add(node.value)})`;
    case 'gte':
      return `(${col} >= ${bag.add(node.value)})`;
    case 'lt':
      return `(${col} < ${bag.add(node.value)})`;
    case 'lte':
      return `(${col} <= ${bag.add(node.value)})`;
    case 'between': {
      const [lo, hi] = (node.values ?? []) as [unknown, unknown];
      return `(${col} BETWEEN ${bag.add(lo)} AND ${bag.add(hi)})`;
    }
    case 'on': {
      // U datetime se porovnává celý den v zóně projektu, ne půlnoc UTC.
      const day = bag.add(node.value);
      return cls === 'datetime'
        ? `((${col} AT TIME ZONE ${bag.ref(3)})::date = ${day}::date)`
        : `(${col} = ${day}::date)`;
    }
    case 'before':
      return `(${col} < ${bag.add(node.value)})`;
    case 'after':
      return `(${col} > ${bag.add(node.value)})`;
    case 'in_last_days':
      return `(${col} >= ${asOf} - make_interval(days => ${bag.add(node.value)}))`;
    case 'not_in_last_days':
      return `(${col} < ${asOf} - make_interval(days => ${bag.add(node.value)}))`;
    case 'in_next_days':
      return `(${col} > ${asOf} AND ${col} <= ${asOf} + make_interval(days => ${bag.add(node.value)}))`;
    default:
      throw new Error(`operator ${operator} is not valid for a contact field`);
  }
}
