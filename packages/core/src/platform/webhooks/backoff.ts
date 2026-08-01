import { loadConfig, type MlainConfig } from '../../config';

/**
 * 3.8, tabulka odstupů. Index je pořadí pokusu minus jedna, takže první pokus
 * jde okamžitě a další čekají uvedený počet sekund od předchozího.
 *
 * Tabulka je zároveň horní mezí pro WEBHOOK_MAX_ATTEMPTS. Rozsah NENÍ 1 až 12:
 * pro pokusy 9 až 12 by neexistovalo definované zpoždění a každá implementace
 * by si ho domyslela jinak. Kdo potřebuje delší okno, prodlouží tabulku novou
 * verzí kontraktu, ne nastavením hodnoty, pro kterou tabulka nemá řádek.
 */
export const WEBHOOK_BACKOFF_SECONDS = [0, 15, 60, 300, 1800, 7200, 21600, 43200] as const;

/** Jitter, aby se po výpadku endpointu nevracely všechny retry naráz. */
export const JITTER_RATIO = 0.2;

/**
 * ODCHYLKA OD PLÁNU: `@mlain/core/config` nevydává hotový objekt `config`,
 * jen továrnu `loadConfig()`. Konfigurace se proto čte líně a memoizuje,
 * stejně jako v `identity/session.ts`, `tx/index.ts` a `net/ssrf.ts`.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * Zpoždění před pokusem číslo `attempt` (od 1). Vrací null, když tabulka pro
 * takový pokus nemá řádek.
 */
export function delayForAttempt(
  attempt: number,
  random: () => number = Math.random,
): number | null {
  const base = WEBHOOK_BACKOFF_SECONDS[attempt - 1];
  if (base === undefined) return null;
  if (base === 0) return 0;
  const factor = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.round(base * factor);
}

/**
 * Čas dalšího pokusu po dokončeném pokusu číslo `completedAttempt`.
 * Vrací null, když už žádný další pokus podle konfigurace nepřijde.
 */
export function nextAttemptAt(
  completedAttempt: number,
  now: Date,
  random: () => number = Math.random,
): Date | null {
  const nextNumber = completedAttempt + 1;
  if (nextNumber > cfg().WEBHOOK_MAX_ATTEMPTS) return null;
  const delay = delayForAttempt(nextNumber, random);
  if (delay === null) return null;
  return new Date(now.getTime() + delay * 1000);
}

export function isFinalAttempt(attempt: number): boolean {
  return attempt >= cfg().WEBHOOK_MAX_ATTEMPTS;
}
