import { createHash, randomBytes } from 'node:crypto';
import { CONFIRMATION_RESEND_MIN_INTERVAL_MS } from '../constants';

/** 32 bajtů v base64url bez paddingu dá přesně 43 znaků. */
export const CONFIRMATION_TOKEN_BYTES = 32;
export const CONFIRMATION_TOKEN_LENGTH = 43;

/**
 * Vydá potvrzovací token podle 4.8.2 části 2.
 *
 * NENÍ to podepsaný token (rozhodnutí R4 plánu). Jednorázovost, TTL na řádku a důkazní
 * evidence IP a user agenta jsou na bezstavovém podepsaném tokenu neproveditelné, a double
 * opt-in existuje právě kvůli důkazní hodnotě. Purpose 'mailer/v1/confirm-token' z tabulky
 * části 1 proto zůstává rezervovaný a nepoužitý; odstranit ho nesmíme, tabulka je zmrazená.
 *
 * Syrový token opouští proces jediným směrem: do odeslaného e-mailu. V databázi je jen hash,
 * takže ani únik zálohy nedovolí nikoho přihlásit.
 */
export function generateConfirmationToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(CONFIRMATION_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashConfirmationToken(token) };
}

/**
 * SHA-256 syrového tokenu. Porovnává se rovností v indexu, ne v aplikaci, takže se tu
 * nehlídá konstantní čas: útočník neporovnává tajemství se známou hodnotou, ale hledá
 * 256bitovou náhodnou hodnotu, u které mu časový kanál nad btree indexem nic nedá.
 */
export function hashConfirmationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function confirmationExpiresAt(now: Date, ttlHours: number): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

export type ConfirmationRow = { expiresAt: Date; consumedAt: Date | null };
export type ConfirmationState = 'valid' | 'expired' | 'consumed' | 'unknown';

/**
 * Rozhodne, v jakém stavu je předložený token.
 *
 * Pořadí podmínek je závazné: spotřebování má přednost před expirací. Kdo klikne podruhé
 * po týdnu, musí vidět "už jste přihlášeni", ne "odkaz vypršel, poslali jsme nový",
 * protože druhá hláška by mu poslala e-mail, o který nikdy nepožádal.
 */
export function classifyConfirmation(row: ConfirmationRow | null, now: Date): ConfirmationState {
  if (row === null) return 'unknown';
  if (row.consumedAt !== null) return 'consumed';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

export type ResendCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'confirmation_resend_too_soon' | 'confirmation_resend_limit';
      retryAfterMs: number;
    };

/**
 * Limity opakovaného odeslání podle 7.4 části 2: nejméně 5 minut mezi e-maily a nejvýš
 * lists.confirmation_max_resends za 24 hodin na kontakt a seznam.
 *
 * Bez nich je potvrzovací formulář nástroj na zaplavení cizí schránky: útočník opakovaně
 * odešle cizí adresu a naše doména za něj rozešle e-maily.
 */
export function canResendConfirmation(input: {
  lastSentAt: Date | null;
  resendsIn24h: number;
  maxResends: number;
  now: Date;
}): ResendCheck {
  if (input.lastSentAt === null) return { ok: true };

  const sinceLast = input.now.getTime() - input.lastSentAt.getTime();
  if (sinceLast < CONFIRMATION_RESEND_MIN_INTERVAL_MS) {
    return {
      ok: false,
      code: 'confirmation_resend_too_soon',
      retryAfterMs: CONFIRMATION_RESEND_MIN_INTERVAL_MS - sinceLast,
    };
  }

  if (input.resendsIn24h >= input.maxResends) {
    const windowEnd = input.lastSentAt.getTime() + 24 * 60 * 60 * 1000;
    return {
      ok: false,
      code: 'confirmation_resend_limit',
      retryAfterMs: Math.max(windowEnd - input.now.getTime(), 1000),
    };
  }

  return { ok: true };
}
