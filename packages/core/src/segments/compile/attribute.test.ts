import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import { compileAttributeCondition } from './attribute';

function bagWithFixed(): ParamBag {
  const bag = new ParamBag(0);
  bag.add('ws');
  bag.add(new Date());
  bag.add('Europe/Prague');
  return bag;
}

describe('attribute conditions', () => {
  it('passes the field key as a parameter, never as a literal', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'eq', { value: 'Praha' }, bag);
    expect(sql).not.toContain("'city'");
    expect(bag.values).toContain('city');
  });

  it('uses jsonb containment for eq on text, with both arguments cast', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'eq', { value: 'Praha' }, bag);
    expect(sql).toBe('(a.attributes @> jsonb_build_object($4::text, $5::text))');
  });

  it('casts both arguments of jsonb_build_object for every field class', () => {
    // Bez castu skončí dotaz na 42P18 could not determine data type of parameter.
    // Je to nejběžnější podmínka segmentu vůbec, takže by to spadlo hned.
    const cases = [
      ['text', 'Praha', '$5::text'],
      ['number', 1000, 'to_jsonb($5::numeric)'],
      ['boolean', true, 'to_jsonb($5::boolean)'],
    ] as const;
    for (const [cls, value, expected] of cases) {
      const sql = compileAttributeCondition('a', 'f', cls, 'eq', { value }, bagWithFixed());
      expect(sql, cls).toBe(`(a.attributes @> jsonb_build_object($4::text, ${expected}))`);
    }
  });

  it('keeps the numeric cast inside CASE WHEN, never after AND', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'order_total', 'number', 'gt', { value: 1000 }, bag);
    expect(sql).toContain('CASE WHEN jsonb_typeof');
    expect(sql).toContain('ELSE NULL END');
    expect(sql).not.toMatch(/AND\s*\(a\.attributes ->> \$\d+\)::numeric/);
  });

  it('gives is_empty three branches including json null', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'is_empty', {}, bag);
    expect(sql).toContain('IS NULL');
    expect(sql).toContain("jsonb_typeof(a.attributes -> $4::text) = 'null'");
    expect(sql).toContain("= ''");
  });

  it('compiles has_any as a disjunction of containments, never with ?|', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition(
      'a',
      'interests',
      'multi_enum',
      'has_any',
      { values: ['a', 'b'] },
      bag,
    );
    expect(sql).toBe(
      '((a.attributes @> jsonb_build_object($4::text, jsonb_build_array($5::text)))' +
        ' OR (a.attributes @> jsonb_build_object($4::text, jsonb_build_array($6::text))))',
    );
  });

  it('never emits an operator that the jsonb_path_ops index cannot serve', () => {
    // idx_contacts__attributes_gin je jsonb_path_ops a ta umí VÝHRADNĚ @>.
    // Kdyby sem kdokoli vrátil ?, ?| nebo ?&, tenhle test to zachytí,
    // a zachytí to i u operátoru, který teprve přibude.
    const cases: [op: 'has_any' | 'has_all' | 'has_none', node: { values: string[] }][] = [
      ['has_any', { values: ['a', 'b'] }],
      ['has_all', { values: ['a', 'b'] }],
      ['has_none', { values: ['a'] }],
    ];
    for (const [op, node] of cases) {
      const sql = compileAttributeCondition(
        'a',
        'interests',
        'multi_enum',
        op,
        node,
        bagWithFixed(),
      );
      expect(sql, op).toContain('@>');
      expect(sql, op).not.toMatch(/\?\||\?&|attributes \?/);
    }
  });

  it('compiles has_all as one containment of the whole array', () => {
    const sql = compileAttributeCondition(
      'a',
      'interests',
      'multi_enum',
      'has_all',
      { values: ['a', 'b'] },
      bagWithFixed(),
    );
    expect(sql).toBe('(a.attributes @> jsonb_build_object($4::text, to_jsonb($5::text[])))');
  });

  it('compiles an empty value list to false instead of empty parentheses', () => {
    const sql = compileAttributeCondition(
      'a',
      'interests',
      'multi_enum',
      'has_any',
      { values: [] },
      bagWithFixed(),
    );
    expect(sql).toBe('(false)');
  });

  it('guards EVERY date cast by validity, not just by json type', () => {
    // jsonb_typeof(...) = 'string' je pravdivé i pro "Praha", protože JSON typ
    // pro datum nemá. Bez pg_input_is_valid by se větev THEN vyhodnotila
    // a cast shodil dotaz chybou 22007.
    for (const op of [
      'on',
      'before',
      'after',
      'in_last_days',
      'not_in_last_days',
      'in_next_days',
    ] as const) {
      const value = op.endsWith('_days') ? 30 : '2026-08-15';
      const sql = compileAttributeCondition(
        'a',
        'signed_at',
        'date',
        op,
        { value },
        bagWithFixed(),
      );
      expect(sql, op).toContain("pg_input_is_valid((a.attributes ->> $4::text), 'timestamptz')");
      expect(sql, op).toContain('ELSE NULL END');
    }
    const between = compileAttributeCondition(
      'a',
      'signed_at',
      'date',
      'between',
      { values: ['2026-01-01', '2026-12-31'] },
      bagWithFixed(),
    );
    expect(between).toContain("pg_input_is_valid((a.attributes ->> $4::text), 'timestamptz')");
  });

  it('escapes like wildcards in contains', () => {
    const bag = bagWithFixed();
    compileAttributeCondition('a', 'note', 'text', 'contains', { value: '50%' }, bag);
    expect(bag.values).toContain('50\\%');
  });
});

/**
 * Tvrdý požadavek zadání: `NOT` nad neznámou hodnotou nesmí být `true`.
 *
 * JSONB containment je totální (chybějící klíč dá `false`), takže právě tady
 * by se to porušilo. Kompilátor proto pod negací žádá tříhodnotový tvar.
 */
describe('three valued logic over a missing key', () => {
  it('wraps a negated eq so that an absent key stays unknown', () => {
    const positive = compileAttributeCondition(
      'a',
      'city',
      'text',
      'eq',
      { value: 'Praha' },
      bagWithFixed(),
    );
    const negated = compileAttributeCondition(
      'a',
      'city',
      'text',
      'eq',
      { value: 'Praha' },
      bagWithFixed(),
      { unknownAware: true },
    );
    expect(positive).not.toContain('CASE WHEN');
    expect(negated).toContain('CASE WHEN');
    expect(negated).toContain('ELSE NULL END');
  });

  it('always wraps neq, because neq is a negation on its own', () => {
    const sql = compileAttributeCondition(
      'a',
      'city',
      'text',
      'neq',
      { value: 'Praha' },
      bagWithFixed(),
    );
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain('ELSE NULL END');
    expect(sql).toContain('NOT (a.attributes @>');
  });

  it('always wraps has_none for the same reason', () => {
    const sql = compileAttributeCondition(
      'a',
      'interests',
      'multi_enum',
      'has_none',
      { values: ['a'] },
      bagWithFixed(),
    );
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain('ELSE NULL END');
  });

  it('keeps the positive eq index friendly, with no CASE around the containment', () => {
    const sql = compileAttributeCondition(
      'a',
      'city',
      'text',
      'eq',
      { value: 'Praha' },
      bagWithFixed(),
    );
    expect(sql.startsWith('(a.attributes @>')).toBe(true);
  });
});
