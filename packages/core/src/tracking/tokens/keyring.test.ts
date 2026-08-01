import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring, deriveTrackingKey } from './keyring';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const EXPECTED_K_TRACKING = 'b9d815e1212e663c64cce1209229e7cf6af10197254677b7eabb575ea2ac3124';

describe('buildTrackingKeyring', () => {
  it('odvodí K_tracking přesně podle vektoru z 3.10 části 1', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    // Keyring nese MASTER, odvození dělá kontraktní kodek. Vektor z části 1 je
    // proto zapsaný nad deriveTrackingKey, ne nad obsahem mapy.
    expect(Buffer.from(deriveTrackingKey(ring.get(1)!)).toString('hex')).toBe(EXPECTED_K_TRACKING);
  });

  it('v keyringu je MASTER, ne odvozený klíč: záměna by tiše dala jiný podpis', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    expect(Buffer.from(ring.get(1)!).toString('base64url')).toBe(TEST_SECRET_KEY);
  });

  it('SECRET_KEY bez prefixu má implicitně key_id 1', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    expect([...ring.keys()]).toEqual([1]);
  });

  it('explicitní 1: dá stejný klíč jako implicitní tvar', () => {
    const implicitRing = buildTrackingKeyring({
      secretKey: TEST_SECRET_KEY,
      secretKeyPrevious: '',
    });
    const explicitRing = buildTrackingKeyring({
      secretKey: `1:${TEST_SECRET_KEY}`,
      secretKeyPrevious: '',
    });
    expect(Buffer.from(explicitRing.get(1)!).toString('hex')).toBe(
      Buffer.from(implicitRing.get(1)!).toString('hex'),
    );
  });

  it('načte i předchozí pokolení a nemá horní strop na jejich počet', () => {
    const previous = Array.from({ length: 40 }, (_, i) => `${i + 2}:${TEST_SECRET_KEY}`).join(',');
    const ring = buildTrackingKeyring({
      secretKey: `42:${TEST_SECRET_KEY}`,
      secretKeyPrevious: previous,
    });
    expect(ring.size).toBe(41);
    expect(ring.has(2)).toBe(true);
    expect(ring.has(41)).toBe(true);
    expect(ring.has(42)).toBe(true);
  });

  it('key_id 0 je neplatný, rozsah je 1 až 255', () => {
    expect(() =>
      buildTrackingKeyring({ secretKey: `0:${TEST_SECRET_KEY}`, secretKeyPrevious: '' }),
    ).toThrow(/key_id/);
  });

  it('klíč, který se nedekóduje na 32 bajtů, se odmítne při startu', () => {
    expect(() => buildTrackingKeyring({ secretKey: 'AAEC', secretKeyPrevious: '' })).toThrow(/32/);
  });
});
