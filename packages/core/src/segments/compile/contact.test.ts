import { describe, expect, it } from 'vitest';
import { ParamBag } from './params';
import { compileContactCondition } from './contact';

/** Tři pevné parametry: workspace_id ($1), asOf ($2), časová zóna projektu ($3). */
function bagWithFixed(): ParamBag {
  const bag = new ParamBag(0);
  bag.add('ws');
  bag.add(new Date());
  bag.add('Europe/Prague');
  return bag;
}

describe('contact conditions', () => {
  it('compiles eq to a parameter', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition(
      'a',
      { kind: 'contact', key: 'status' },
      'eq',
      { value: 'active' },
      bag,
    );
    expect(sql).toBe('(a.status = $4)');
    expect(bag.values[3]).toBe('active');
  });

  it('never puts the user value into the sql text', () => {
    const bag = bagWithFixed();
    const evil = "'; DROP TABLE contacts; --";
    const sql = compileContactCondition(
      'a',
      { kind: 'contact', key: 'first_name' },
      'eq',
      { value: evil },
      bag,
    );
    expect(sql).not.toContain('DROP');
    expect(sql).toContain('$4');
    expect(bag.values[3]).toBe(evil);
  });

  it('compiles in_last_days against asOf, never now()', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition(
      'a',
      { kind: 'contact', key: 'created_at' },
      'in_last_days',
      { value: 30 },
      bag,
    );
    expect(sql).toBe('(a.created_at >= $2::timestamptz - make_interval(days => $4))');
    expect(sql.toLowerCase()).not.toContain('now(');
  });

  it('casts asOf explicitly in EVERY relative time expression', () => {
    // Bez ::timestamptz odvodí PostgreSQL typ parametru z okolí a u odčítání
    // intervalu ho určí jako interval. Viz komentář u ASOF_CAST v contact.ts.
    for (const op of ['in_last_days', 'not_in_last_days', 'in_next_days'] as const) {
      const sql = compileContactCondition(
        'a',
        { kind: 'contact', key: 'created_at' },
        op,
        { value: 30 },
        bagWithFixed(),
      );
      expect(sql, op).toContain('$2::timestamptz');
      expect(sql, op).not.toMatch(/\$2(?!::timestamptz)/);
    }
  });

  it('compiles contains with ILIKE and escaped wildcards', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition(
      'a',
      { kind: 'contact', key: 'email' },
      'contains',
      { value: '100%' },
      bag,
    );
    expect(sql).toBe("(a.email::text ILIKE '%' || $4 || '%')");
    expect(bag.values[3]).toBe('100\\%');
  });

  it('uses the given alias everywhere', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition(
      'x9',
      { kind: 'contact', key: 'status' },
      'eq',
      { value: 'active' },
      bag,
    );
    expect(sql).toContain('x9.status');
    expect(sql).not.toContain('c.');
  });

  it('compares a datetime `on` in the workspace timezone, not at UTC midnight', () => {
    const sql = compileContactCondition(
      'a',
      { kind: 'contact', key: 'created_at' },
      'on',
      { value: '2026-07-31' },
      bagWithFixed(),
    );
    expect(sql).toBe('((a.created_at AT TIME ZONE $3)::date = $4::date)');
  });

  it('refuses an alias that is not a plain identifier', () => {
    expect(() =>
      compileContactCondition(
        'a"; DROP TABLE contacts; --',
        { kind: 'contact', key: 'status' },
        'eq',
        { value: 'x' },
        bagWithFixed(),
      ),
    ).toThrowError(/invalid alias/);
  });
});
