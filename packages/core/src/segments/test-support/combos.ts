import { FIELD_CLASS_OPERATORS } from '../operators';
import type { ConditionNode, Operator, SegmentAst } from '../ast';

/**
 * Kombinace pole a operátoru pro sadu invariantů.
 *
 * Bydlí ve VLASTNÍM modulu, ne v testovém souboru, a je to podstatné: import
 * z `*.test.ts` do jiného `*.test.ts` znovu vyhodnotí jeho `describe`, takže by
 * se ty testy zaregistrovaly podruhé v importujícím souboru. Naměřeno: databázová
 * sada hlásila 542 testů místo svých zhruba 130, protože si přitáhla celou sadu
 * invariantů. Zdroj kombinací přitom musí zůstat JEDEN, jinak by textová
 * a databázová kontrola ověřovaly každá něco jiného.
 */
export const COMBOS: [cls: string, op: Operator][] = Object.entries(FIELD_CLASS_OPERATORS).flatMap(
  ([cls, ops]) => ops.map((op) => [cls, op] as [string, Operator]),
);

export const UUID_A = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60aa';
export const UUID_B = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f60bb';

export const NULLARY_OPERATORS = new Set<string>([
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
]);

export const INVARIANT_OPTS = {
  alias: 'a',
  paramOffset: 0,
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6001',
  asOf: new Date('2026-07-31T10:00:00Z'),
  timezone: 'Europe/Prague',
  fieldClasses: {
    txt: 'text' as const,
    num: 'number' as const,
    dt: 'datetime' as const,
    ml: 'multi_enum' as const,
    bl: 'boolean' as const,
  },
  segmentKinds: { [UUID_B]: { kind: 'static' as const } },
};

/** Třídy, u kterých je volný text od uživatele legitimní hodnota. */
export const FREE_TEXT_CLASSES = new Set<string>([
  'text',
  'long_text',
  'url',
  'email',
  'phone',
  'email_domain',
  'enum',
  'multi_enum',
]);

/**
 * Hodnota, která odpovídá TŘÍDĚ pole, ne jen tvaru operátoru.
 *
 * Dřív to byly dvě funkce, jedna pro text a jedna pro databázi, a ta textová
 * dávala `{ value: 'value' }` i číselnému poli. Textová sada to nezachytila,
 * protože do databáze nejde, ale běh proti PostgreSQL skončil na
 * `22P02 invalid input syntax for type numeric`. Zdroj hodnot je proto jeden
 * a typově správný, a to, co ten běh odhalil, hlídá `assertValueMatchesClass`.
 */
export function valueFor(cls: string, operator: string): Partial<ConditionNode> {
  if (NULLARY_OPERATORS.has(operator)) return {};
  const isNumber = cls === 'number';
  const isDate = cls === 'date' || cls === 'datetime';

  if (operator === 'between') {
    if (isDate) return { values: ['2026-01-01', '2026-12-31'] };
    return { values: [1, 2] };
  }
  if (operator === 'in' || operator === 'not_in') {
    if (cls === 'enum') return { values: ['active', 'bounced'] };
    if (isNumber) return { values: [1, 2] };
    return { values: ['x', 'y'] };
  }
  if (operator === 'has_any' || operator === 'has_all' || operator === 'has_none') {
    return cls === 'tag' ? { values: [UUID_A, UUID_B] } : { values: ['a', 'b'] };
  }
  if (['in_last_days', 'not_in_last_days', 'in_next_days'].includes(operator)) {
    return { value: 30 };
  }
  if (['count_gte', 'count_lte'].includes(operator)) return { value: 3 };
  if (['gt', 'gte', 'lt', 'lte'].includes(operator)) return { value: 5 };
  if (['on', 'before', 'after'].includes(operator)) return { value: '2026-07-01' };
  if (operator === 'eq' || operator === 'neq') {
    if (isNumber) return { value: 1000 };
    if (isDate) return { value: '2026-07-01' };
    if (cls === 'enum') return { value: 'active' };
    if (cls === 'boolean') return { value: true };
  }
  return { value: 'value' };
}

/** Jedna dvojice pole a operátoru pro každý řádek typové matice. */
export function fieldFor(fieldClass: string): ConditionNode['field'] {
  switch (fieldClass) {
    case 'text':
    case 'long_text':
    case 'url':
    case 'email':
    case 'phone':
      return { kind: 'attribute', key: 'txt' };
    case 'email_domain':
      return { kind: 'contact', key: 'email_domain' };
    case 'number':
      return { kind: 'attribute', key: 'num' };
    case 'boolean':
      return { kind: 'attribute', key: 'bl' };
    case 'date':
    case 'datetime':
      return { kind: 'contact', key: 'created_at' };
    case 'enum':
      return { kind: 'contact', key: 'status' };
    case 'multi_enum':
      return { kind: 'attribute', key: 'ml' };
    case 'tag':
      return { kind: 'tag' };
    case 'list':
      return { kind: 'list', list_id: UUID_A };
    case 'consent':
      return { kind: 'consent', purpose: 'email_marketing' };
    case 'suppression':
      return { kind: 'suppression' };
    case 'engagement':
      return { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } };
    case 'event':
      return { kind: 'event', name: 'purchase' };
    case 'segment':
      return { kind: 'segment', segment_id: UUID_B };
    default:
      throw new Error(`unmapped field class ${fieldClass}`);
  }
}

export function astFor(
  cls: string,
  operator: Operator,
  patch?: Partial<ConditionNode>,
): SegmentAst {
  return {
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      children: [
        {
          type: 'condition',
          field: fieldFor(cls),
          operator,
          ...(patch ?? valueFor(cls, operator)),
        } as ConditionNode,
      ],
    },
  };
}
