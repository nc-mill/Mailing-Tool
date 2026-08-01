import { describe, expect, it } from 'vitest';
import { canonicalJson, designHash } from '../../src/document/canonical';

describe('canonical serialization', () => {
  it('orders object keys lexicographically and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined properties but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('keeps non-ascii characters as UTF-8, not as escapes', () => {
    expect(canonicalJson({ v: 'Žofie' })).toBe('{"v":"Žofie"}');
  });

  it('gives the same hash for the same content in a different key order', () => {
    const a = { schemaVersion: 1, meta: { language: 'cs', name: 'X', previewText: '' } };
    const b = { meta: { name: 'X', previewText: '', language: 'cs' }, schemaVersion: 1 };
    expect(designHash(a)).toEqual(designHash(b));
  });

  it('gives a different hash for different content', () => {
    expect(designHash({ a: 1 })).not.toEqual(designHash({ a: 2 }));
  });

  it('returns 32 raw bytes, ready for the bytea column', () => {
    expect(designHash({ a: 1 })).toBeInstanceOf(Buffer);
    expect(designHash({ a: 1 })).toHaveLength(32);
  });
});
