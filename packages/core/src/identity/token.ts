import { createHash, randomBytes } from 'node:crypto';

/** 3.2: 32 náhodných bajtů z CSPRNG. */
export const TOKEN_BYTES = 32;
/** base64url bez paddingu z 32 bajtů má právě 43 znaků. */
export const TOKEN_LENGTH = 43;

/**
 * Používá se pro session token, token pozvánky i token resetu hesla.
 * Všechny tři mají stejné parametry a v databázi z nich leží jen SHA-256.
 */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 z ASCII reprezentace tokenu, ne z dekódovaných bajtů.
 * Rozdíl je podstatný, protože závazný testovací vektor ve 3.2 platí pro ASCII.
 * SHA-256 stačí, protože vstup má 256 bitů entropie z CSPRNG a slovníkový
 * ani hrubý útok na takový vstup nedává smysl.
 */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'ascii').digest();
}
