// Ověřování chyb databáze v testech.
//
// `.rejects.toThrow(/row-level security/i)` nad `tx.execute` se NIKDY neshodne,
// takže test projde i nad tabulkou, kterou RLS vůbec nechrání. Naměřeno:
//   message      = "Failed query: INSERT INTO tags (workspace_id, name) VALUES ..."
//   pgErrorCode  = "42501"
//   cause.message= "new row violates row-level security policy for table \"tags\""
// Chyba z Drizzle je DrizzleQueryError a text z databáze leží na `cause.message`,
// zatímco chyba ze syrového `pool.query` ho má rovnou na `message`. Je to tatáž
// past jako rozhodnutí R35, jen o úroveň vedle. Proto se text i kód čtou
// výhradně přes tenhle pomocník a žádný test nesahá na `message` přímo.
import { expect } from 'vitest';
import { pgErrorCode } from '../../src/repo/tx';

/** insufficient_privilege. Nese ho jak "permission denied", tak porušení RLS. */
export const INSUFFICIENT_PRIVILEGE = '42501';

export type PgFailure = {
  /** SQLSTATE, ať přišel z Drizzle nebo ze syrového klienta. */
  code: string | undefined;
  /** Text OD DATABÁZE, ne obálka Drizzle. */
  message: string;
  raw: unknown;
};

/** Text, který napsala databáze. U Drizzle leží o úroveň níž, na `cause`. */
export function databaseMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === 'object' && cause !== null) {
      const nested = (cause as { message?: unknown }).message;
      if (typeof nested === 'string') return nested;
    }
    const direct = (error as { message?: unknown }).message;
    if (typeof direct === 'string') return direct;
  }
  return String(error);
}

/**
 * Spustí callback a vrátí chybu, kterou vrátila databáze. Když dotaz projde,
 * padá test tady, ne o řádek níž na porovnání s `undefined`.
 */
export async function catchPgError(run: () => Promise<unknown>): Promise<PgFailure> {
  try {
    await run();
  } catch (error) {
    return { code: pgErrorCode(error), message: databaseMessage(error), raw: error };
  }
  throw new Error('očekávala se chyba databáze, ale dotaz prošel bez chyby');
}

/** Obecný tvar: konkrétní SQLSTATE a konkrétní text od databáze. */
export async function expectPgError(
  run: () => Promise<unknown>,
  code: string,
  pattern: RegExp,
  hint = '',
): Promise<PgFailure> {
  const failure = await catchPgError(run);
  expect(
    failure.code,
    `${hint} očekáván SQLSTATE ${code}, přišlo ${failure.code}: ${failure.message}`,
  ).toBe(code);
  expect(failure.message, `${hint} text od databáze neodpovídá ${pattern}`).toMatch(pattern);
  return failure;
}

/**
 * Porušení RLS. Kód 42501 sám nestačí: nese ho i chybějící grant, takže bez
 * kontroly textu by test „RLS chrání" prošel nad tabulkou, na kterou role
 * jen nemá práva.
 */
export async function expectRlsViolation(
  run: () => Promise<unknown>,
  hint = '',
): Promise<PgFailure> {
  return expectPgError(run, INSUFFICIENT_PRIVILEGE, /violates row-level security policy/i, hint);
}

/** Chybějící oprávnění. Tentýž SQLSTATE, jiný text, jiná příčina. */
export async function expectPermissionDenied(
  run: () => Promise<unknown>,
  hint = '',
): Promise<PgFailure> {
  return expectPgError(run, INSUFFICIENT_PRIVILEGE, /permission denied/i, hint);
}
