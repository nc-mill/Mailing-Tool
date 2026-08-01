import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../errors/api-error';

export const CSRF_HEADER = 'X-CSRF-Token';

/**
 * 3.2, sekundární obrana pro formuláře a Server Actions.
 * Primární obrana je SameSite=Lax plus kontrola Origin.
 *
 * Pozor na rozsah platnosti (4.1): tohle se uplatňuje JEN na interním povrchu
 * a na Server Actions. Na /api/v1/** s API klíčem, na trackovacích cestách ani
 * na příchozích webhoocích ne, protože ty nepocházejí z prohlížeče a klíč se
 * neposílá automaticky.
 */
export function csrfTokenFor(csrfSecret: Buffer): string {
  return createHmac('sha256', csrfSecret).update('csrf', 'ascii').digest('base64url');
}

export function assertCsrfToken(csrfSecret: Buffer, provided: string | null | undefined): void {
  if (!provided) throw new ApiError('csrf_token_invalid');
  const expected = Buffer.from(csrfTokenFor(csrfSecret), 'ascii');
  const actual = Buffer.from(provided, 'ascii');
  // timingSafeEqual hodí výjimku při rozdílné délce, proto se délka kontroluje předem.
  if (expected.length !== actual.length) throw new ApiError('csrf_token_invalid');
  if (!timingSafeEqual(expected, actual)) throw new ApiError('csrf_token_invalid');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 3.2: Origin musí odpovídat APP_URL. Porovnává se celý origin, tedy schéma,
 * host i port; shoda jen v hostu by pustila http variantu a jiný port.
 */
export function assertOrigin(
  method: string,
  origin: string | null | undefined,
  appUrl: string,
): void {
  if (SAFE_METHODS.has(method.toUpperCase())) return;
  if (!origin) throw new ApiError('origin_not_allowed');
  const expected = new URL(appUrl).origin;
  let actual: string;
  try {
    actual = new URL(origin).origin;
  } catch {
    throw new ApiError('origin_not_allowed');
  }
  if (actual !== expected) throw new ApiError('origin_not_allowed', { params: { origin: actual } });
}
