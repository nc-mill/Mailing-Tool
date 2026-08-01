import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ParamBag, toSql } from './params';

describe('ParamBag', () => {
  it('numbers from paramOffset + 1', () => {
    const bag = new ParamBag(5);
    expect(bag.add('a')).toBe('$6');
    expect(bag.add('b')).toBe('$7');
    expect(bag.values).toEqual(['a', 'b']);
  });

  it('numbers from $1 with no offset', () => {
    const bag = new ParamBag(0);
    expect(bag.add('a')).toBe('$1');
  });

  it('casts when a cast is given', () => {
    const bag = new ParamBag(0);
    expect(bag.add(['x'], 'uuid[]')).toBe('$1::uuid[]');
  });

  it('never reuses a placeholder for a different value', () => {
    const bag = new ParamBag(0);
    expect(bag.add('a')).toBe('$1');
    expect(bag.add('a')).toBe('$2');
  });

  it('refers to an already added value without adding it again', () => {
    const bag = new ParamBag(0);
    bag.add('ws');
    bag.add('asOf');
    expect(bag.ref(2, 'timestamptz')).toBe('$2::timestamptz');
    expect(bag.values).toHaveLength(2);
  });
});

const render = (text: string, params: unknown[]) => new PgDialect().sqlToQuery(toSql(text, params));

describe('toSql', () => {
  it('keeps a list value as ONE parameter, not as expanded elements', () => {
    const out = render('SELECT 1 WHERE s = ANY($1)', [['active', 'pending']]);
    expect(out.sql).toBe('SELECT 1 WHERE s = ANY($1)');
    expect(out.params).toEqual([['active', 'pending']]);
  });

  it('binds a repeated placeholder once per occurrence, with the same value', () => {
    const asOf = new Date('2026-01-01T00:00:00Z');
    const out = render('SELECT 1 WHERE a >= $2 AND b <= $2 AND c = $1', ['ws', asOf]);
    expect(out.sql).toBe('SELECT 1 WHERE a >= $1 AND b <= $2 AND c = $3');
    expect(out.params).toEqual([asOf, asOf, 'ws']);
  });

  it('leaves a cast suffix in the query text', () => {
    expect(render('SELECT $1::uuid[]', [['a']]).sql).toBe('SELECT $1::uuid[]');
  });

  it('refuses a placeholder that has no value instead of binding undefined', () => {
    expect(() => toSql('SELECT $3', ['only-one'])).toThrowError(/\$3/);
  });
});
