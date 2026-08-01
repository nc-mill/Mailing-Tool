import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';

const VECTOR_JSON =
  '{"k":["2026-07-31T14:22:03.000Z","0192f3a0-1c2d-7e43-8d4e-5f60718293a4"],"d":"n","o":"created_at.desc"}';
const VECTOR_ENCODED =
  'eyJrIjpbIjIwMjYtMDctMzFUMTQ6MjI6MDMuMDAwWiIsIjAxOTJmM2EwLTFjMmQtN2U0My04ZDRlLTVmNjA3MTgyOTNhNCJdLCJkIjoibiIsIm8iOiJjcmVhdGVkX2F0LmRlc2MifQ';

describe('kurzor', () => {
  it('zakóduje vektor z konvence 4.3 části 1 doslova', () => {
    expect(
      encodeCursor({
        k: ['2026-07-31T14:22:03.000Z', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4'],
        d: 'n',
        o: 'created_at.desc',
      }),
    ).toBe(VECTOR_ENCODED);
  });

  it('dekóduje týž vektor zpět', () => {
    expect(decodeCursor(VECTOR_ENCODED, 'created_at.desc')).toEqual(JSON.parse(VECTOR_JSON));
  });

  it('odmítne kurzor s jiným řazením kódem validation_failed', () => {
    expect(() => decodeCursor(VECTOR_ENCODED, 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('odmítne poškozený kurzor kódem validation_failed', () => {
    expect(() => decodeCursor('tohle-neni-base64url-json', 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('odmítne kurzor bez pole o', () => {
    const broken = Buffer.from('{"k":["a"],"d":"n"}', 'utf8').toString('base64url');
    expect(() => decodeCursor(broken, 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});
