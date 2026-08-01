import { describe, expect, it } from 'vitest';
import { canonicalJson, definitionHash } from './canonical';

describe('canonical json', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps array order', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('produces the same hash for differently ordered but equal objects', () => {
    const one = definitionHash({ version: 1, root: { type: 'group', op: 'and', children: [] } });
    const two = definitionHash({ root: { children: [], op: 'and', type: 'group' }, version: 1 });
    expect(one.equals(two)).toBe(true);
    expect(one).toHaveLength(32);
  });

  it('produces a different hash when a value changes', () => {
    expect(definitionHash({ a: 1 }).equals(definitionHash({ a: 2 }))).toBe(false);
  });
});
