import type { ContactFieldKey, Operator } from './ast';
import { invalidAst, tooMany } from './errors';

export type FieldClass =
  | 'text'
  | 'long_text'
  | 'url'
  | 'email'
  | 'phone'
  | 'email_domain'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multi_enum'
  | 'tag'
  | 'list'
  | 'consent'
  | 'suppression'
  | 'engagement'
  | 'event'
  | 'segment';

const TEXT_OPS: Operator[] = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
];

export const FIELD_CLASS_OPERATORS: Record<FieldClass, Operator[]> = {
  text: TEXT_OPS,
  long_text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  email_domain: TEXT_OPS,
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false', 'is_empty'],
  date: [
    'on',
    'before',
    'after',
    'between',
    'in_last_days',
    'not_in_last_days',
    'in_next_days',
    'is_empty',
    'is_not_empty',
  ],
  datetime: [
    'on',
    'before',
    'after',
    'between',
    'in_last_days',
    'not_in_last_days',
    'in_next_days',
    'is_empty',
    'is_not_empty',
  ],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi_enum: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  tag: ['has_any', 'has_all', 'has_none'],
  list: ['is_member', 'is_not_member', 'is_confirmed', 'is_pending', 'is_unsubscribed'],
  consent: ['is_granted', 'is_withdrawn', 'is_missing'],
  suppression: ['is_suppressed', 'is_not_suppressed'],
  engagement: ['did', 'did_not', 'count_gte', 'count_lte'],
  event: ['did', 'did_not', 'count_gte', 'count_lte'],
  segment: ['in', 'not_in'],
};

const CONTACT_FIELD_CLASS: Record<ContactFieldKey, FieldClass> = {
  email: 'email',
  email_domain: 'email_domain',
  first_name: 'text',
  last_name: 'text',
  gender: 'enum',
  status: 'enum',
  locale: 'enum',
  source: 'enum',
  created_at: 'datetime',
  updated_at: 'datetime',
  last_activity_at: 'datetime',
  vocative_confidence: 'enum',
  processing_restricted: 'boolean',
};

export function contactFieldClass(key: ContactFieldKey): FieldClass {
  return CONTACT_FIELD_CLASS[key];
}

/** Třídy z `contact_fields.type`. Kdyby P07 přidal typ, tenhle převod ho odmítne. */
const CUSTOM_FIELD_CLASSES: readonly FieldClass[] = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'multi_enum',
  'url',
  'email',
  'phone',
];

export function customFieldClass(type: string): FieldClass {
  const found = CUSTOM_FIELD_CLASSES.find((c) => c === type);
  if (!found) throw new Error(`unknown contact_fields.type: ${type}`);
  return found;
}

export function assertOperatorAllowed(fieldClass: FieldClass, operator: Operator): void {
  const allowed = FIELD_CLASS_OPERATORS[fieldClass];
  if (!allowed.includes(operator)) {
    invalidAst(
      'operator',
      'segment_operator_not_allowed',
      `operator ${operator} is not allowed for field class ${fieldClass}`,
      { fieldClass, operator, allowed },
    );
  }
}

const NULLARY: Operator[] = [
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
  'did',
  'did_not',
  'is_suppressed',
  'is_not_suppressed',
  'is_member',
  'is_not_member',
  'is_confirmed',
  'is_pending',
  'is_unsubscribed',
  'is_granted',
  'is_withdrawn',
  'is_missing',
];
const MULTI: Operator[] = ['in', 'not_in', 'has_any', 'has_all', 'has_none', 'between'];
const DAY_COUNT: Operator[] = ['in_last_days', 'not_in_last_days', 'in_next_days'];
const COUNTER: Operator[] = ['count_gte', 'count_lte'];

export type ValueShape = { value?: unknown; values?: unknown[] | undefined };

function invalid(detail: string): never {
  return invalidAst('value', 'segment_invalid_ast', detail);
}

const NUMERIC_CLASSES = new Set<FieldClass>(['number']);
const DATE_CLASSES = new Set<FieldClass>(['date', 'datetime']);
const VALUE_COMPARISON: Operator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'on',
  'before',
  'after',
];

/**
 * Hodnota musí sedět na TŘÍDU pole, ne jen na tvar operátoru.
 *
 * DOPLNĚK NAD RÁMEC PLÁNU, a vyšel z běhu proti databázi. Plán kontroluje tvar
 * (`assertValueShape`) a typ sloupcové strany (`CASE WHEN jsonb_typeof(...)`),
 * ale typ HODNOTY od uživatele nekontroluje nikde. Podmínka
 * `{ field: 'objednavka_celkem', operator: 'eq', value: 'value' }` se proto
 * zkompilovala na `to_jsonb($n::numeric)` a spadla až v databázi na
 * `22P02 invalid input syntax for type numeric`. Je to přesně ta chyba, kvůli
 * které rozhodnutí R9 zavádí `CASE WHEN` na druhé straně porovnání, jen se
 * k ní jde z opačného konce a `CASE WHEN` proti ní nepomůže: cast parametru
 * proběhne při vazbě, ne při vyhodnocení řádku.
 *
 * Odmítnutí je proto tady, ve validaci, kde skončí jako 422 s vysvětlením,
 * ne jako pětistovka z runtime databáze.
 */
export function assertValueMatchesClass(
  fieldClass: FieldClass,
  operator: Operator,
  node: ValueShape,
): void {
  if (!VALUE_COMPARISON.includes(operator)) return;
  const values = node.values ?? (node.value === undefined ? [] : [node.value]);
  if (NUMERIC_CLASSES.has(fieldClass)) {
    for (const v of values) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        invalidAst('value', 'segment_invalid_ast', `${fieldClass} field expects a number`, {
          fieldClass,
          operator,
          got: v === null ? 'null' : typeof v,
        });
      }
    }
  }
  if (DATE_CLASSES.has(fieldClass)) {
    for (const v of values) {
      if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
        invalidAst('value', 'segment_invalid_ast', `${fieldClass} field expects a date string`, {
          fieldClass,
          operator,
          got: v === null ? 'null' : typeof v,
        });
      }
    }
  }
}

export function assertValueShape(operator: Operator, node: ValueShape): void {
  if (NULLARY.includes(operator)) {
    if (node.value !== undefined || node.values !== undefined) {
      invalid(`${operator} takes no value`);
    }
    return;
  }
  if (MULTI.includes(operator)) {
    if (!Array.isArray(node.values)) invalid(`${operator} requires values`);
    if (node.value !== undefined) invalid(`${operator} must not carry value`);
    const values = node.values as unknown[];
    if (values.length < 1 || values.length > 1000) {
      tooMany('segment_list_too_long', { limit: 1000, got: values.length });
    }
    const kinds = new Set(values.map((v) => (v === null ? 'null' : typeof v)));
    if (kinds.size > 1) invalid('values must share one type');
    if (operator === 'between') {
      if (values.length !== 2) invalid('between requires exactly two values');
      const [a, b] = values as [number | string, number | string];
      if (a > b) {
        invalidAst('value', 'segment_invalid_range', 'between requires values[0] <= values[1]');
      }
    }
    return;
  }
  if (node.values !== undefined) invalid(`${operator} must not carry values`);
  if (node.value === undefined) invalid(`${operator} requires value`);
  if (DAY_COUNT.includes(operator)) {
    const n = node.value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3650) {
      invalid(`${operator} expects an integer 1 to 3650`);
    }
  }
  if (COUNTER.includes(operator)) {
    const n = node.value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
      invalid(`${operator} expects an integer 0 to 1000000`);
    }
  }
}
