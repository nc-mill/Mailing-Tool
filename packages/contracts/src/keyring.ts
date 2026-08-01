import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Odvození klíčů (KONTRAKT, část 1, kapitola 3.10, sdílené s 4.10.3 a 4.10.4).
 *
 *   SECRET_KEY  = base64url bez paddingu, dekóduje se na přesně 32 bajtů
 *   MASTER      = base64url_decode(SECRET_KEY)
 *   K_<purpose> = HKDF(SHA-256, ikm = MASTER, salt = "mailer/v1", info = <purpose>, L = 32)
 *
 * Salt ani purposes se PŘI PŘEJMENOVÁNÍ PRODUKTU NEMĚNÍ a jméno produktu v nich
 * schválně není. Otisky v suppression listu nejdou přepočítat, protože plaintext
 * je po výmazu podle GDPR pryč; změna řetězce by tiše vzkřísila smazané lidi.
 */
export const HKDF_SALT = 'mailer/v1';

export const KEY_PURPOSES = Object.freeze({
  trackingToken: 'mailer/v1/tracking-token',
  credentialEncryption: 'mailer/v1/credential-encryption',
  secretKeyFingerprint: 'mailer/v1/secret-key-fingerprint',
  formToken: 'mailer/v1/form-token',
  confirmToken: 'mailer/v1/confirm-token',
  assetUrl: 'mailer/v1/asset-url',
  suppressionFingerprint: 'mailer/v1/suppression-fingerprint',
});

export type ParsedSecretKey = { keyId: number; master: Uint8Array };
export type Keyring = Map<number, Uint8Array>;

function decodeBase64Url(value: string): Uint8Array {
  if (/[^A-Za-z0-9\-_]/.test(value)) {
    throw new Error('SECRET_KEY musí být base64url bez paddingu (abeceda A-Za-z0-9-_)');
  }
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Přijímá `<base64url>` i `<key_id>:<base64url>`. Bez key_id platí implicitní 1. */
export function parseSecretKey(value: string): ParsedSecretKey {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(':');
  const keyId = separator === -1 ? 1 : Number(trimmed.slice(0, separator));
  const encoded = separator === -1 ? trimmed : trimmed.slice(separator + 1);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    throw new Error(`key_id musí být celé číslo 1 až 255, je ${trimmed.slice(0, separator)}`);
  }
  const master = decodeBase64Url(encoded);
  if (master.length !== 32) {
    throw new Error(`SECRET_KEY se musí dekódovat na přesně 32 bajtů, má ${master.length}`);
  }
  return { keyId, master };
}

/**
 * Poskládá keyring z aktuálního klíče a všech předchozích pokolení.
 *
 * STROP NA POČET POKOLENÍ NEEXISTUJE a nesmí se zavést ani jako validace.
 * Otisk starého záznamu nejde nikdy přepočítat, takže po překročení stropu by
 * se smazaný člověk vrátil prvním dalším importem, aniž by cokoliv selhalo.
 */
export function parseKeyring(input: {
  secretKey: string;
  secretKeyPrevious?: string | undefined;
}): Keyring {
  const keyring: Keyring = new Map();
  const current = parseSecretKey(input.secretKey);
  keyring.set(current.keyId, current.master);
  for (const entry of (input.secretKeyPrevious ?? '').split(',')) {
    if (entry.trim() === '') continue;
    const parsed = parseSecretKey(entry);
    if (!keyring.has(parsed.keyId)) keyring.set(parsed.keyId, parsed.master);
  }
  return keyring;
}

export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  if (!env.SECRET_KEY) throw new Error('SECRET_KEY je povinná proměnná');
  return parseKeyring({ secretKey: env.SECRET_KEY, secretKeyPrevious: env.SECRET_KEY_PREVIOUS });
}

/** Aktuální klíč je ten s nejvyšším key_id; jím se podepisuje a šifruje. */
export function currentKeyId(keyring: Keyring): number {
  return Math.max(...keyring.keys());
}

export function deriveKey(master: Uint8Array, purpose: string): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', master, Buffer.from(HKDF_SALT, 'ascii'), Buffer.from(purpose, 'ascii'), 32),
  );
}

/**
 * base64url(HMAC-SHA256(K_secret-key-fingerprint, "fingerprint")[0..8])
 *
 * Vstupem je MASTER, ne odvozený klíč: odvození si funkce dělá sama. Jméno je
 * `secretKeyFingerprint`, protože pod ním ho volají ostatní plány (rozhodnutí R6);
 * dřívější `keyFingerprint` se nepoužívá. Volání s už odvozeným klíčem odvodí
 * klíč podruhé a dá tiše jiný otisk, což je požadavek P02→P16.1.
 */
export function secretKeyFingerprint(master: Uint8Array): string {
  const key = deriveKey(master, KEY_PURPOSES.secretKeyFingerprint);
  const mac = createHmac('sha256', key).update('fingerprint').digest();
  return mac.subarray(0, 8).toString('base64url');
}
