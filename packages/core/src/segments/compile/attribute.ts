import type { Operator } from '../ast';
import type { FieldClass } from '../operators';
import type { ParamBag } from './params';
import { assertAlias } from './columns';
import { escapeLike } from './contact';

type Node = { value?: unknown; values?: unknown[] | undefined };

/**
 * Volby kompilace vlastního pole.
 *
 * `unknownAware` je ODCHYLKA OD PLÁNU a je vynucená tvrdým požadavkem na
 * tříhodnotovou logiku: `NOT` nad neznámou hodnotou nesmí vyjít `true`.
 *
 * JSONB containment (`@>`) je TOTÁLNÍ predikát: pro chybějící klíč vrací `false`,
 * ne `NULL`. V kladné pozici je to jedno, protože `false` i `NULL` znamenají
 * „nevyhovuje". Pod negací se to ale rozchází: `NOT false` je `true`, takže by
 * se do negované skupiny dostali i lidé, u kterých hodnotu vůbec neznáme.
 *
 * Řešení je kontextové, ne plošné. Kompilátor ví, kolik negací je nad uzlem,
 * a jen pod lichým počtem si vyžádá `unknownAware`, kde se containment obalí
 * `CASE WHEN <klíč je vyplněný> THEN <predikát> ELSE NULL END`. V kladné pozici
 * zůstává holé `@>`, takže index `idx_contacts__attributes_gin` s třídou
 * `jsonb_path_ops` dál obsluhuje nejběžnější podmínku segmentu.
 */
export type AttributeCompileOptions = { unknownAware?: boolean };

/** „Klíč je vyplněný a není to JSON null." Základ tříhodnotové logiky nad JSONB. */
function presentSql(alias: string, keyRef: string): string {
  return `(${alias}.attributes -> ${keyRef}) IS NOT NULL AND jsonb_typeof(${alias}.attributes -> ${keyRef}) <> 'null'`;
}

function unknownWhenAbsent(alias: string, keyRef: string, predicate: string): string {
  return `(CASE WHEN ${presentSql(alias, keyRef)} THEN ${predicate} ELSE NULL END)`;
}

/**
 * Přetypování `::numeric` je VŽDY uvnitř CASE WHEN, nikdy za AND.
 * PostgreSQL negarantuje pořadí vyhodnocení operandů AND a plánovač je přehazuje
 * podle odhadované ceny, takže cast za AND může proběhnout i na řádku, kde
 * jsonb_typeof není 'number'. Jediná textová hodnota v poli typu number pak shodí
 * celý dotaz chybou 22P02, a to nedeterministicky, podle plánu. CASE WHEN je jediná
 * konstrukce, u které SQL standard i PostgreSQL garantují, že se větev THEN
 * nevyhodnotí, když podmínka neplatí.
 *
 * Větev ELSE je `NULL`, ne `false`. Plán psal `false`; `NULL` je striktně lepší:
 * v kladné pozici se chová stejně (`WHERE` neznámo vyřadí), pod negací ale
 * `NOT NULL` zůstane neznámo, kdežto `NOT false` by bylo `true` a segment
 * „NENÍ dražší než tisíc" by vracel i lidi s textem v číselném poli.
 */
function numericGuard(alias: string, keyRef: string, comparison: string): string {
  return `(CASE WHEN jsonb_typeof(${alias}.attributes -> ${keyRef}) = 'number' THEN ${comparison} ELSE NULL END)`;
}

/**
 * Totéž pro datumy, ale `jsonb_typeof(...) = 'string'` NESTAČÍ a je to past,
 * která vypadá jako hotová ochrana.
 *
 * JSON typ pro datum nemá, datum je uložené jako řetězec. Podmínka na `'string'`
 * je tedy pravdivá i pro hodnotu `"Praha"`, větev THEN se vyhodnotí a
 * `'Praha'::timestamptz` shodí celý dotaz chybou
 * `22007 invalid input syntax for type timestamp with time zone`.
 *
 * `pg_input_is_valid(text, type)` je v PostgreSQL od verze 16 a vrací `false`
 * místo chyby. Projekt stojí na 18, takže je k dispozici.
 */
function dateGuard(alias: string, keyRef: string, textRef: string, comparison: string): string {
  return (
    `(CASE WHEN jsonb_typeof(${alias}.attributes -> ${keyRef}) = 'string'` +
    ` AND pg_input_is_valid(${textRef}, 'timestamptz')` +
    ` THEN ${comparison} ELSE NULL END)`
  );
}

/**
 * Klíč i hodnota jdou do `jsonb_build_object` VŽDY s explicitním castem.
 *
 * Ověřeno spuštěním: `jsonb_build_object($1, $2)` skončí chybou
 * `42P18 could not determine data type of parameter $1`, protože funkce je
 * variadická nad `any` a PostgreSQL nemá z čeho typ odvodit. Bez castu by tedy
 * spadla KAŽDÁ rovnost nad vlastním polem, což je ta úplně nejběžnější
 * podmínka segmentu, a spadla by hned při prvním použití.
 */
function containment(alias: string, keyRef: string, valueRef: string): string {
  return `(${alias}.attributes @> jsonb_build_object(${keyRef}, ${valueRef}))`;
}

function jsonValue(fieldClass: FieldClass, value: unknown, bag: ParamBag): string {
  if (fieldClass === 'number') return `to_jsonb(${bag.add(value, 'numeric')})`;
  if (fieldClass === 'boolean') return `to_jsonb(${bag.add(value, 'boolean')})`;
  return bag.add(value === null || value === undefined ? null : String(value), 'text');
}

/**
 * „Obsahuje aspoň jednu z hodnot" se skládá jako disjunkce containmentů, protože
 * `@>` nad polem znamená „obsahuje VŠECHNY", ne „aspoň jednu". Každý člen
 * disjunkce je samostatně indexovatelný.
 *
 * Prázdný seznam vrací `false`, ne prázdnou závorku: `()` je syntaktická chyba
 * a `OR` bez operandů taky.
 */
function anyContainment(
  alias: string,
  keyRef: string,
  values: readonly unknown[],
  bag: ParamBag,
): string {
  if (values.length === 0) return '(false)';
  const parts = values.map((v) =>
    containment(alias, keyRef, `jsonb_build_array(${bag.add(String(v), 'text')})`),
  );
  return `(${parts.join(' OR ')})`;
}

export function compileAttributeCondition(
  alias: string,
  key: string,
  fieldClass: FieldClass,
  operator: Operator,
  node: Node,
  bag: ParamBag,
  opts: AttributeCompileOptions = {},
): string {
  assertAlias(alias);
  const k = bag.add(key, 'text');
  const text = `(${alias}.attributes ->> ${k})`;
  const asOf = bag.ref(2, 'timestamptz');
  /** Containment je totální, takže pod negací potřebuje obal na neznámo. */
  const total = (predicate: string): string =>
    opts.unknownAware === true ? unknownWhenAbsent(alias, k, predicate) : predicate;

  switch (operator) {
    case 'eq':
      return total(containment(alias, k, jsonValue(fieldClass, node.value, bag)));
    case 'neq':
      // `neq` je negace sama o sobě, takže obal na neznámo má VŽDY, bez ohledu
      // na kontext. Bez něj by „město není Praha" vracelo i kontakty bez města.
      return unknownWhenAbsent(
        alias,
        k,
        `(NOT ${containment(alias, k, jsonValue(fieldClass, node.value, bag))})`,
      );
    case 'contains':
      return `(${text} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'not_contains':
      return `(${text} NOT ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'starts_with':
      return `(${text} ILIKE ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'ends_with':
      return `(${text} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))})`;
    case 'in':
      return `(${text} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')}))`;
    case 'not_in':
      return `(NOT (${text} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')})))`;
    case 'is_empty':
      return `((${alias}.attributes -> ${k}) IS NULL OR jsonb_typeof(${alias}.attributes -> ${k}) = 'null' OR ${text} = '')`;
    case 'is_not_empty':
      return `((${alias}.attributes -> ${k}) IS NOT NULL AND jsonb_typeof(${alias}.attributes -> ${k}) <> 'null' AND ${text} <> '')`;
    case 'is_true':
      return unknownWhenAbsent(alias, k, `((${alias}.attributes -> ${k}) = 'true'::jsonb)`);
    case 'is_false':
      return unknownWhenAbsent(alias, k, `((${alias}.attributes -> ${k}) = 'false'::jsonb)`);
    case 'gt':
      return numericGuard(alias, k, `${text}::numeric > ${bag.add(node.value)}`);
    case 'gte':
      return numericGuard(alias, k, `${text}::numeric >= ${bag.add(node.value)}`);
    case 'lt':
      return numericGuard(alias, k, `${text}::numeric < ${bag.add(node.value)}`);
    case 'lte':
      return numericGuard(alias, k, `${text}::numeric <= ${bag.add(node.value)}`);
    case 'between': {
      const [lo, hi] = (node.values ?? []) as [unknown, unknown];
      if (fieldClass === 'number') {
        return numericGuard(alias, k, `${text}::numeric BETWEEN ${bag.add(lo)} AND ${bag.add(hi)}`);
      }
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz BETWEEN ${bag.add(lo)}::timestamptz AND ${bag.add(hi)}::timestamptz`,
      );
    }
    case 'on':
      return dateGuard(
        alias,
        k,
        text,
        `(${text}::timestamptz AT TIME ZONE ${bag.ref(3)})::date = ${bag.add(node.value)}::date`,
      );
    case 'before':
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz < ${bag.add(node.value)}::timestamptz`,
      );
    case 'after':
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz > ${bag.add(node.value)}::timestamptz`,
      );
    case 'in_last_days':
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz >= ${asOf} - make_interval(days => ${bag.add(node.value)})`,
      );
    case 'not_in_last_days':
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz < ${asOf} - make_interval(days => ${bag.add(node.value)})`,
      );
    case 'in_next_days':
      return dateGuard(
        alias,
        k,
        text,
        `${text}::timestamptz > ${asOf} AND ${text}::timestamptz <= ${asOf} + make_interval(days => ${bag.add(node.value)})`,
      );
    // Operátory nad seznamem hodnot jdou přes @>, ne přes ?| a ?&.
    // Důvod je index: jediný GIN nad attributes je idx_contacts__attributes_gin
    // s operátorovou třídou jsonb_path_ops, a ta podporuje VÝHRADNĚ @>.
    // Operátory ?, ?| a ?& umí jen výchozí jsonb_ops, takže by šly seq scanem
    // přes všechny kontakty. Druhý index se zakládat nesmí a nebyl by ani správný:
    // P03 zvolil jsonb_path_ops vědomě, je menší a rychlejší.
    case 'has_any':
      return total(anyContainment(alias, k, node.values ?? [], bag));
    case 'has_all':
      // Jedno containment, protože @> nad polem znamená "obsahuje všechny prvky".
      return total(
        containment(alias, k, `to_jsonb(${bag.add((node.values ?? []).map(String), 'text[]')})`),
      );
    case 'has_none':
      // Negace, takže obal na neznámo vždycky.
      return unknownWhenAbsent(
        alias,
        k,
        `(NOT ${anyContainment(alias, k, node.values ?? [], bag)})`,
      );
    default:
      throw new Error(`operator ${operator} is not valid for an attribute field`);
  }
}
