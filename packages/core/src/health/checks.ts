import type { Check, LivenessResult } from './types';
import { aiKeyVariablesPresent } from '../config/ai-keys';

export function liveness(mode: string, version: string): LivenessResult {
  return { status: 'ok', mode, version };
}

/**
 * Druhá vrstva ochrany proti klíčům AI providerů v prostředí. Entrypoint je
 * maže; když se přesto objeví, znamená to, že proces někdo spustil mimo
 * entrypoint. Readiness to nesráží, protože klíč se stejně nepoužije, ale
 * varování musí být vidět.
 */
export function aiKeyLeakCheck(env: Record<string, string | undefined> = process.env): Check {
  return async () => {
    const leaked = aiKeyVariablesPresent(env);
    if (leaked.length === 0) return { name: 'ai_keys', status: 'ok' };
    return {
      name: 'ai_keys',
      status: 'warn',
      detail: `ai_key_leaked_from_env: ${leaked.join(', ')}`,
    };
  };
}

/**
 * Otisk aktuálního SECRET_KEY proti otisku uloženému v databázi.
 * Kritérium 56: neshoda je varování, ne selhání, aby start proběhl.
 * Dotaz dodá volající, protože přístup k databázi vlastní P03.
 */
export function secretKeyFingerprintCheck(
  query: () => Promise<{ stored: string | null; current: string }>,
): Check {
  return async () => {
    const { stored, current } = await query();
    if (stored === null || stored === current) return { name: 'secret_key', status: 'ok' };
    return {
      name: 'secret_key',
      status: 'warn',
      detail: 'secret_key_fingerprint_mismatch',
    };
  };
}
