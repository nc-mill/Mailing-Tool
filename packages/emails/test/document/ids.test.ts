import { describe, expect, it } from 'vitest';
import { BLOCK_ID_PATTERN, isBlockId, newBlockId } from '../../src/document/ids';

describe('block id', () => {
  it('generates ids matching the normative pattern', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newBlockId();
      expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(isBlockId(id)).toBe(true);
    }
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newBlockId()));
    expect(ids.size).toBe(1000);
  });

  it('rejects ids that are not b_ plus 12 lowercase alphanumerics', () => {
    expect(isBlockId('b_ABCDEFGHIJKL')).toBe(false);
    expect(isBlockId('b_abcdefghijk')).toBe(false);
    expect(isBlockId('c_abcdefghijkl')).toBe(false);
    expect(isBlockId('b_abcdefghijklm')).toBe(false);
    expect(isBlockId('')).toBe(false);
  });
});
