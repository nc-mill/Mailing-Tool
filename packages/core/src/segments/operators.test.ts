import { describe, expect, it } from 'vitest';
import { OPERATORS } from './ast';
import {
  FIELD_CLASS_OPERATORS,
  assertOperatorAllowed,
  assertValueShape,
  contactFieldClass,
} from './operators';
import { segmentErrorCode } from './errors';

/**
 * Doménový kód se čte z `params`, ne z `error.message`.
 *
 * ODCHYLKA OD PLÁNU. Plán psal `toThrowError(/segment_operator_not_allowed/)`.
 * Takový test NEPROJDE ANI KDYŽ KÓD FUNGUJE: zpráva `ApiError` je kořenové
 * `code` z registru P01, tedy `validation_failed` nebo `too_many_items`,
 * a doménový kód v ní není. Je to táž past, jakou plán sám popisuje
 * u `error.cause.code`, jen o patro výš.
 */
function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'operace měla selhat, ale prošla').toBeDefined();
  expect(segmentErrorCode(caught)).toBe(code);
}

describe('operator matrix', () => {
  it('declares exactly 40 operators', () => {
    expect(OPERATORS).toHaveLength(40);
    expect(new Set(OPERATORS).size).toBe(40);
  });

  it('uses every declared operator in at least one field class', () => {
    const used = new Set(Object.values(FIELD_CLASS_OPERATORS).flat());
    expect([...OPERATORS].filter((o) => !used.has(o))).toEqual([]);
  });

  it('maps contact fields to their classes', () => {
    expect(contactFieldClass('status')).toBe('enum');
    expect(contactFieldClass('created_at')).toBe('datetime');
    expect(contactFieldClass('processing_restricted')).toBe('boolean');
  });

  it('rejects contains on a number field', () => {
    expectCode(() => assertOperatorAllowed('number', 'contains'), 'segment_operator_not_allowed');
  });

  it('rejects between with three values', () => {
    expectCode(() => assertValueShape('between', { values: [1, 2, 3] }), 'segment_invalid_ast');
  });

  it('rejects between with a reversed range', () => {
    expectCode(() => assertValueShape('between', { values: [9, 2] }), 'segment_invalid_range');
  });

  it('rejects a value on a nullary operator', () => {
    expectCode(() => assertValueShape('is_empty', { value: 'x' }), 'segment_invalid_ast');
  });

  it('rejects in_last_days outside 1 to 3650', () => {
    expectCode(() => assertValueShape('in_last_days', { value: 0 }), 'segment_invalid_ast');
    expectCode(() => assertValueShape('in_last_days', { value: 3651 }), 'segment_invalid_ast');
  });

  it('rejects a list longer than 1000 items with its own code', () => {
    expectCode(
      () => assertValueShape('in', { values: Array.from({ length: 1001 }, (_, i) => String(i)) }),
      'segment_list_too_long',
    );
  });

  it('rejects a mixed type value list', () => {
    expectCode(() => assertValueShape('in', { values: ['a', 1] }), 'segment_invalid_ast');
  });
});

/**
 * Odkaz na jiný segment nese cíl v POLI, ne v hodnotě, a kompilátor žádnou
 * hodnotu nečte. Obecná tabulka tvarů přitom řadí `in` mezi seznamové, takže
 * podmínka „je v segmentu" bez hodnot končila na 422 a uložit se dala jen
 * s vymyšleným výčtem, který nic neznamenal.
 */
describe('odkaz na jiný segment', () => {
  it('nepotřebuje hodnoty', () => {
    expect(() => assertValueShape('in', {}, 'segment')).not.toThrow();
    expect(() => assertValueShape('not_in', {}, 'segment')).not.toThrow();
  });

  it('staré uložené definice s výčtem zůstávají platné', () => {
    expect(() => assertValueShape('in', { values: ['cokoliv'] }, 'segment')).not.toThrow();
  });

  it('u ostatních tříd výčet dál vyžaduje', () => {
    expectCode(() => assertValueShape('in', {}, 'text'), 'segment_invalid_ast');
    expectCode(() => assertValueShape('has_any', {}, 'tag'), 'segment_invalid_ast');
  });
});

