import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  KEY_PURPOSES,
  currentKeyId,
  deriveKey,
  keyringFromEnv,
  type Keyring,
} from '@mlain/contracts/keyring';

// Purpose ani odvození klíče si tenhle soubor NEDEFINUJE. Zmrazený řetězec
// 'mailer/v1/form-token' je v KEY_PURPOSES.formToken a HKDF sůl uvnitř deriveKey.
// Dřívější znění mělo obojí vlastní; byla by to třetí kopie téhož receptu vedle
// kontraktu a modulu otisků, a kopie se rozcházejí tiše.
//
// Purpose je podle rozhodnutí R4 správný právě tenhle: pro double opt-in se
// mailer/v1/confirm-token NEPOUŽÍVÁ, protože jeho potvrzovací token je náhodných
// 32 bajtů se stavem v databázi, ne podepsaný token. (Ten purpose od P13 používá
// podepsaný odkaz na ověření adresy ve zkušebním režimu, viz providers/trial-token.ts.)

const NONCE_TTL_MS = 30 * 60 * 1000;

/**
 * Prefix adresy, ne celá adresa. U IPv4 tři oktety, u IPv6 první čtyři skupiny.
 *
 * Vázat nonce na celou adresu nejde: mobilní klient může mezi načtením stránky
 * a odesláním formuláře přejít mezi sítěmi a legitimní odeslání by selhalo.
 * Prefix je kompromis, který zastaví přeposlání nonce úplně jinam a nezasekne
 * běžného návštěvníka.
 */
function ipPrefix(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
  return ip.split('.').slice(0, 3).join('.');
}

export type NonceContext = { formId: string; ip: string };

function macFor(master: Uint8Array, payload: string): string {
  return createHmac('sha256', deriveKey(master, KEY_PURPOSES.formToken))
    .update(payload, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

export function issueNonce(
  keyring: Keyring,
  context: NonceContext,
): { value: string; issuedAt: number } {
  const issuedAt = Date.now();
  const payload = `${context.formId}.${issuedAt}.${ipPrefix(context.ip)}`;
  // deriveKey a KEY_PURPOSES jsou z kontraktu P02. Purpose mailer/v1/form-token
  // je podle rozhodnutí R4 jediný, který se na nonce formuláře smí použít.
  const master = keyring.get(currentKeyId(keyring));
  if (master === undefined) throw new Error('keyring nezná aktuální pokolení');
  return { value: `${issuedAt}.${macFor(master, payload)}`, issuedAt };
}

/**
 * Nonce s keyringem z prostředí. Používá ho hostovaná stránka formuláře v `apps/web`,
 * která `@mlain/contracts` mezi závislostmi nemá a mít nemá: klíče vlastní doména,
 * ne stránka.
 */
export function issueFormNonce(context: NonceContext): { value: string; issuedAt: number } {
  return issueNonce(keyringFromEnv(), context);
}

export type NonceVerification =
  { ok: true; issuedAt: number } | { ok: false; reason: 'malformed' | 'expired' | 'invalid' };

/** Nonce se neukládá, je bezstavový. Ověřuje se přes všechna známá pokolení klíče. */
export function verifyNonce(
  keyring: Keyring,
  value: string,
  context: NonceContext,
): NonceVerification {
  const parts = value.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed' };
  if (Date.now() - issuedAt > NONCE_TTL_MS) return { ok: false, reason: 'expired' };

  const payload = `${context.formId}.${issuedAt}.${ipPrefix(context.ip)}`;
  const provided = Buffer.from(parts[1] ?? '', 'utf8');

  // Přes VŠECHNA známá pokolení, bez stropu. Nonce vydaný před rotací klíče musí
  // projít, jinak by rotace zneplatnila každý formulář otevřený v prohlížeči.
  for (const master of keyring.values()) {
    const expected = Buffer.from(macFor(master, payload), 'utf8');
    // Porovnání v konstantním čase, jako u každého tajemství v produktu.
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return { ok: true, issuedAt };
    }
  }
  return { ok: false, reason: 'invalid' };
}

/**
 * Kolik sekund uplynulo od vydání nonce. Je to jediný zdroj pro časovou past:
 * hodnota z klienta se nepoužívá, protože ji bot nastaví na cokoliv.
 */
export function elapsedSinceNonce(value: string, now: number = Date.now()): number {
  const issuedAt = Number(value.split('.')[0]);
  if (!Number.isFinite(issuedAt)) return 0;
  return Math.max(0, Math.floor((now - issuedAt) / 1000));
}
