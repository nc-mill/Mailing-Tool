import type { Keyring } from '@mlain/contracts/keyring';
import { verifyNonce } from './nonce';
import type { FormRateLimiter } from './rate-limit';

export type ProtectionForm = {
  id: string;
  honeypotField: string;
  minFillSeconds: number;
  allowedOrigins: readonly string[];
  captchaProvider: 'none' | 'turnstile' | 'hcaptcha';
};

export type ProtectionInput = {
  origin: string | null;
  nonce: string | undefined;
  ip: string;
  fields: Record<string, unknown>;
  elapsedSeconds: number;
  captchaToken?: string;
};

export type ProtectionResult =
  | { outcome: 'accept' }
  /** Tiché zahození: odpoví se stejným úspěchem jako u platného odeslání. */
  | { outcome: 'drop'; reason: 'honeypot' | 'too_fast' | 'missing_nonce' | 'invalid_nonce' }
  /** Hlasité odmítnutí: chyba, kterou uvidí i vývojář, co formulář vkládal. */
  | { outcome: 'reject'; code: 'origin_not_allowed' | 'captcha_failed' }
  /** Pátá vrstva. Vrací se 429 s Retry-After, protože je to strop, ne obvinění. */
  | {
      outcome: 'rate_limited';
      scope: 'ip_minute' | 'ip_hour' | 'form_minute';
      retryAfterSeconds: number;
    };

/**
 * PĚT nezávislých vrstev ochrany podle 4.13.3 části 2. Všech pět je vynucených TADY.
 *
 * Klasická ochrana proti padělání požadavku tady nedává smysl: formulář z definice
 * běží na cizí doméně a endpoint nesmí číst cookie.
 *
 * Rozdíl mezi drop a reject je záměrný. Odmítnutí BOTEM je vždy TICHÉ: odpoví se
 * stejným úspěchem jako u platného odeslání, takže se bot nedozví, které pravidlo
 * ho chytlo. Chybný PŮVOD je naopak hlasitý, protože ho způsobí chybné vložení
 * formuláře a vývojář na druhé straně musí vidět, co je špatně.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán měl u páté vrstvy jen komentář „rate limit se
 * aplikuje mimo tuhle funkci, v middleware endpointu" a žádný kód. Ochrana, kterou
 * vynucuje jen komentář, přestane platit prvním endpointem, který si na ni nevzpomene,
 * a nic o tom nezčervená. Limiter je proto POVINNÝ PARAMETR: cesta, která ho nepředá,
 * se nepřeloží. Vrstva se navíc vyhodnocuje JAKO PRVNÍ, protože jinak by zaplavení
 * formuláře platilo čtyřmi dražšími kontrolami (dvě odvození klíče na nonce) dřív,
 * než by ho strop zastavil.
 */
export function checkProtection(
  keyring: Keyring,
  form: ProtectionForm,
  input: ProtectionInput,
  limiter: FormRateLimiter,
): ProtectionResult {
  // Vrstva 5: strop na počet odeslání. Per IP i per formulář, viz rozhodnutí R10.
  const verdict = limiter.consume({ formId: form.id, ip: input.ip });
  if (!verdict.allowed) {
    return {
      outcome: 'rate_limited',
      scope: verdict.scope,
      retryAfterSeconds: verdict.retryAfterSeconds,
    };
  }

  // Vrstva 1: původ. Prázdný seznam znamená libovolný původ, ale rozhraní u toho
  // zobrazí varování.
  if (form.allowedOrigins.length > 0) {
    if (input.origin === null || !form.allowedOrigins.includes(input.origin)) {
      return { outcome: 'reject', code: 'origin_not_allowed' };
    }
  }

  // Vrstva 2: nonce. Zastaví slepé skriptované odesílání bez načtení stránky.
  if (input.nonce === undefined) return { outcome: 'drop', reason: 'missing_nonce' };
  const nonce = verifyNonce(keyring, input.nonce, { formId: form.id, ip: input.ip });
  if (!nonce.ok) return { outcome: 'drop', reason: 'invalid_nonce' };

  // Vrstva 3: časová past. Člověk formulář nevyplní za nula sekund.
  if (input.elapsedSeconds < form.minFillSeconds) {
    return { outcome: 'drop', reason: 'too_fast' };
  }

  // Vrstva 4: honeypot. Skryté pole, které člověk nevidí a bot vyplní.
  const honeypot = input.fields[form.honeypotField];
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    return { outcome: 'drop', reason: 'honeypot' };
  }

  // Volitelná captcha. Ve výchozím stavu vypnutá, protože posílá data návštěvníka
  // třetí straně, což je v rozporu se slibem o nulové povinné komunikaci s cizím cloudem.
  if (form.captchaProvider !== 'none' && (input.captchaToken ?? '').length === 0) {
    return { outcome: 'reject', code: 'captcha_failed' };
  }

  return { outcome: 'accept' };
}

/**
 * Jména vrstev v pořadí, ve kterém je `checkProtection` vyhodnocuje. Test se na tenhle
 * seznam ptá, aby vypuštění kterékoliv vrstvy zčervenalo, i kdyby si toho nikdo nevšiml
 * v diffu.
 */
export const PROTECTION_LAYERS = [
  'rate_limit',
  'origin',
  'nonce',
  'time_trap',
  'honeypot',
] as const;
