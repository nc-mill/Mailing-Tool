import { describe, it, expect } from 'vitest';
import { generateOpaqueToken, tokenHash, TOKEN_BYTES, TOKEN_LENGTH } from './token';

/** Závazný vektor ze 3.2, přepočítaný spuštěním 2026-07-31. */
const VECTOR_TOKEN = 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14';
const VECTOR_SHA256 = '0a7edca7df64fa7710681987f4f809f6f72b37a34602c7472673009382665ecd';

describe('opaque token', () => {
  it('má 32 bajtů entropie a 43 znaků base64url bez paddingu', () => {
    expect(TOKEN_BYTES).toBe(32);
    expect(TOKEN_LENGTH).toBe(43);
    const token = generateOpaqueToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain('=');
  });

  it('dva tokeny nejsou stejné', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    expect(set.size).toBe(1000);
  });

  it('tokenHash odpovídá závaznému vektoru ze 3.2', () => {
    expect(tokenHash(VECTOR_TOKEN).toString('hex')).toBe(VECTOR_SHA256);
  });

  it('tokenHash je 32 bajtů', () => {
    expect(tokenHash(generateOpaqueToken())).toHaveLength(32);
  });

  it('hashuje ASCII reprezentaci tokenu, ne dekódované bajty', () => {
    // Kdyby se hashovaly dekódované bajty, výsledek by se od vektoru lišil.
    const decodedHash = tokenHash(Buffer.from(VECTOR_TOKEN, 'base64url').toString('latin1'));
    expect(decodedHash.toString('hex')).not.toBe(VECTOR_SHA256);
  });
});
