import type { Problem } from '@/lib/api-client/problem';

/** Klíč pro chyby, které nepatří ke konkrétnímu poli. */
export const FORM_LEVEL_KEY = '__form__';

/** Cesty, které server vrací, ale uživatel je ve formuláři nevidí. */
const NON_FIELD_PATHS = new Set(['', 'Idempotency-Key', 'X-Reauth-Password']);

export type FieldErrors = Record<string, string[]>;

export function fieldErrorsFrom(problem: Problem): FieldErrors {
  if (problem.code !== 'validation_failed' || !problem.errors) return {};

  const grouped: FieldErrors = {};
  for (const entry of problem.errors) {
    const key = NON_FIELD_PATHS.has(entry.path) ? FORM_LEVEL_KEY : entry.path;
    (grouped[key] ??= []).push(entry.message);
  }
  return grouped;
}

export function formLevelErrors(errors: FieldErrors): string[] {
  return errors[FORM_LEVEL_KEY] ?? [];
}

export function firstErrorField(errors: FieldErrors): string | undefined {
  return Object.keys(errors).find((key) => key !== FORM_LEVEL_KEY);
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
