import { describe, expect, it } from 'vitest';
import {
  deriveKey,
  KEY_PURPOSES,
  parseKeyring,
  parseSecretKey,
  secretKeyFingerprint,
} from '../src/keyring';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('odvození klíčů podle 3.10', () => {
  it('dekóduje SECRET_KEY na přesně 32 bajtů', () => {
    const parsed = parseSecretKey(TEST_SECRET_KEY);
    expect(parsed.keyId).toBe(1);
    expect(Buffer.from(parsed.master).toString('hex')).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    );
  });

  it('přijme explicitní key_id', () => {
    expect(parseSecretKey(`7:${TEST_SECRET_KEY}`).keyId).toBe(7);
  });

  it('odmítne klíč jiné délky než 32 bajtů', () => {
    expect(() => parseSecretKey('AAEC')).toThrow(/32/);
  });

  it.each([
    [
      'mailer/v1/tracking-token',
      'b9d815e1212e663c64cce1209229e7cf6af10197254677b7eabb575ea2ac3124',
    ],
    [
      'mailer/v1/credential-encryption',
      '83cdc2ac660d3400913cf6c99a981a465f20f0e56610dd413fa7667e30fb8040',
    ],
    [
      'mailer/v1/secret-key-fingerprint',
      '58c150fe5d466b4fa3e4d69d855c79763d1f0ccf0875c05594ff93cf8d6aead2',
    ],
  ])('odvodí %s na závazný vektor', (purpose, expected) => {
    const { master } = parseSecretKey(TEST_SECRET_KEY);
    expect(Buffer.from(deriveKey(master, purpose)).toString('hex')).toBe(expected);
  });

  it('má sedm zmrazených purposes a jméno produktu v nich není', () => {
    expect(Object.values(KEY_PURPOSES)).toHaveLength(7);
    for (const purpose of Object.values(KEY_PURPOSES)) {
      expect(purpose.startsWith('mailer/v1/')).toBe(true);
      expect(purpose.toLowerCase()).not.toContain('mlain');
    }
  });

  it('spočítá otisk klíče z MASTER, ne z odvozeného klíče', () => {
    expect(secretKeyFingerprint(parseSecretKey(TEST_SECRET_KEY).master)).toBe('VXGoNjoPSBY');
  });

  it('nemá horní strop na počet pokolení', () => {
    const previous = Array.from({ length: 40 }, (_, i) => `${i + 2}:${TEST_SECRET_KEY}`).join(',');
    const keyring = parseKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: previous });
    expect(keyring.size).toBe(41);
    expect(keyring.has(41)).toBe(true);
  });

  it('odmítne key_id mimo rozsah jednoho bajtu', () => {
    expect(() => parseKeyring({ secretKey: `256:${TEST_SECRET_KEY}` })).toThrow(/1 až 255/);
    expect(() => parseKeyring({ secretKey: `0:${TEST_SECRET_KEY}` })).toThrow(/1 až 255/);
  });
});
