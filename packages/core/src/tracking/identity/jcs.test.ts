import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './jcs';
import {
  PII_TRAIT_KEYS,
  hasPiiTraits,
  identifySigningInput,
  verifyIdentifySignature,
} from './signature';

/**
 * ODCHYLKA OD PLÁNU, JEN TECHNICKÁ: plán měl pomocnou funkci `signForTest`
 * s `require('node:crypto')` uvnitř. Balíček je ESM (`"type": "module"`),
 * takže `require` v něm neexistuje a test by spadl na ReferenceError.
 * Import je nahoře, chování je totéž.
 */
function signForTest(secret: Buffer, externalId: string, traits: Record<string, unknown>): string {
  return createHmac('sha256', secret)
    .update(identifySigningInput(externalId, traits))
    .digest('base64url');
}

describe('canonicalize (RFC 8785)', () => {
  it('sedí na závazný vektor z 3.6.3', () => {
    expect(
      canonicalize({
        first_name: 'Jan',
        email: 'jan@example.cz',
        orders: 3,
        ltv: 1490.5,
        vip: true,
        note: 'čeština',
      }),
    ).toBe(
      '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}',
    );
  });

  it('prázdné traits jsou {}, ne prázdný řetězec', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('klíče se řadí podle UTF-16 code unitů, ne podle locale', () => {
    expect(canonicalize({ b: 1, A: 2, a: 3, Z: 4 })).toBe('{"A":2,"Z":4,"a":3,"b":1}');
  });

  it('celé číslo se nezapisuje s desetinnou částí', () => {
    expect(canonicalize({ n: 1.0 })).toBe('{"n":1}');
  });

  it('diakritika se zapisuje jako surové UTF-8, neescapuje se', () => {
    expect(canonicalize({ x: 'ěščřž' })).toBe('{"x":"ěščřž"}');
  });

  it('řídicí znaky se escapují minimálně', () => {
    expect(canonicalize({ x: 'a\nb"c\\d' })).toBe('{"x":"a\\nb\\"c\\\\d"}');
  });

  it('vnořené objekty se řadí na každé úrovni', () => {
    expect(canonicalize({ b: { d: 1, c: 2 }, a: [3, { f: 4, e: 5 }] })).toBe(
      '{"a":[3,{"e":5,"f":4}],"b":{"c":2,"d":1}}',
    );
  });

  it('null a hodnoty undefined: null zůstává, undefined vypadává', () => {
    expect(canonicalize({ a: null, b: undefined, c: 1 })).toBe('{"a":null,"c":1}');
  });

  it('NaN ani Infinity nejsou platný JSON a skončí výjimkou', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(/RFC 8785/);
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(/RFC 8785/);
  });
});

describe('verifyIdentifySignature', () => {
  const secret = Buffer.from('ml_live_0123456789abcdef', 'utf8');
  const traits = { first_name: 'Jan', email: 'jan@example.cz' };

  it('platný podpis projde', () => {
    const signature = signForTest(secret, 'customer_8472', traits);
    expect(
      verifyIdentifySignature({ externalId: 'customer_8472', traits, signature, secret }),
    ).toBe(true);
  });

  it('podpis pro jiné traits neprojde', () => {
    const signature = signForTest(secret, 'customer_8472', { first_name: 'Jan' });
    expect(
      verifyIdentifySignature({ externalId: 'customer_8472', traits, signature, secret }),
    ).toBe(false);
  });

  it('podpis pro jiné external_id neprojde', () => {
    const signature = signForTest(secret, 'customer_1', traits);
    expect(verifyIdentifySignature({ externalId: 'customer_2', traits, signature, secret })).toBe(
      false,
    );
  });

  it('podpis jiným klíčem neprojde', () => {
    const signature = signForTest(Buffer.from('jiny_klic', 'utf8'), 'customer_8472', traits);
    expect(
      verifyIdentifySignature({ externalId: 'customer_8472', traits, signature, secret }),
    ).toBe(false);
  });

  it('podpis nesprávné délky neprojde a nevyhodí výjimku', () => {
    expect(verifyIdentifySignature({ externalId: 'a', traits, signature: 'x', secret })).toBe(
      false,
    );
    expect(verifyIdentifySignature({ externalId: 'a', traits, signature: '', secret })).toBe(false);
  });

  it('external_id s bajtem 0x0A se odmítne, ne aby se hádalo', () => {
    expect(() =>
      verifyIdentifySignature({ externalId: 'a\nb', traits, signature: 'x', secret }),
    ).toThrow(/0x0A/);
  });

  it('rozpozná traits s osobními údaji', () => {
    expect(PII_TRAIT_KEYS).toContain('email');
    expect(PII_TRAIT_KEYS).toContain('phone');
    expect(hasPiiTraits({ email: 'a@b.cz' })).toBe(true);
    expect(hasPiiTraits({ EMAIL: 'a@b.cz' })).toBe(true);
    expect(hasPiiTraits({ first_name: 'Jan' })).toBe(false);
    expect(hasPiiTraits({})).toBe(false);
  });
});
