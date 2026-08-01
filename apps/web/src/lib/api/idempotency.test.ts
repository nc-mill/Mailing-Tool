import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { canonicalJson, fingerprintOf, validateIdempotencyKey } from './idempotency';

describe('kanonizace těla', () => {
  it('seřadí klíče podle kódových bodů', () => {
    expect(canonicalJson({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
  });

  it('vnořené objekty se kanonizují taky', () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it('pole si drží pořadí', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('bez nevýznamných mezer', () => {
    expect(canonicalJson({ a: 1 })).not.toContain(' ');
  });

  it('čísla v nejkratší podobě', () => {
    expect(canonicalJson({ a: 1.0, b: 1e2 })).toBe('{"a":1,"b":100}');
  });
});

describe('otisk requestu', () => {
  it('je stejný pro přeformátované stejné tělo', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x', scopes: ['a'] });
    const b = fingerprintOf('POST', '/api/v1/api-keys', { scopes: ['a'], name: 'x' });
    expect(a.equals(b)).toBe(true);
  });

  it('se liší při jiné cestě', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('POST', '/api/v1/webhook-endpoints', { name: 'x' });
    expect(a.equals(b)).toBe(false);
  });

  it('se liší při jiné metodě', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('PATCH', '/api/v1/api-keys', { name: 'x' });
    expect(a.equals(b)).toBe(false);
  });

  it('se liší při jiné hodnotě v těle', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('POST', '/api/v1/api-keys', { name: 'y' });
    expect(a.equals(b)).toBe(false);
  });
});

describe('validace hlavičky', () => {
  it('projde osmiznakový klíč', () => {
    expect(validateIdempotencyKey('abcdefgh')).toBe('abcdefgh');
  });

  it('chybějící hlavička končí 422 s cestou Idempotency-Key', () => {
    try {
      validateIdempotencyKey(undefined);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(422);
      expect(err.errors?.[0]?.path).toBe('Idempotency-Key');
    }
  });

  it('sedmiznakový klíč končí 422', () => {
    expect(() => validateIdempotencyKey('abcdefg')).toThrow(ApiError);
  });

  it('klíč s mezerou končí 422', () => {
    expect(() => validateIdempotencyKey('abcdefg h')).toThrow(ApiError);
  });

  it('klíč nad 255 znaků končí 422', () => {
    expect(() => validateIdempotencyKey('a'.repeat(256))).toThrow(ApiError);
  });
});
