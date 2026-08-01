import { ApiError } from '../../errors/api-error';

export const IMPORT_STATES = [
  'pending',
  'validating',
  'previewing',
  'importing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;

export type ImportState = (typeof IMPORT_STATES)[number];

export const TERMINAL_STATES: ImportState[] = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
];

const ALLOWED: Record<ImportState, ImportState[]> = {
  pending: ['validating', 'failed'],
  validating: ['previewing', 'failed'],
  // previewing → validating je ZAKÁZÁNO: idempotency_key obsahuje mapování,
  // takže změna mapování zakládá nový import, ne návrat o krok zpět.
  previewing: ['importing', 'cancelled', 'failed'],
  importing: ['completed', 'completed_with_errors', 'cancelled', 'failed'],
  completed: [],
  completed_with_errors: [],
  failed: [],
  cancelled: [],
};

export function isImportState(value: string): value is ImportState {
  return (IMPORT_STATES as readonly string[]).includes(value);
}

/**
 * `invalid_state_transition` je registrovaný kořenový kód se stavem 409, takže
 * se nemusí schovávat pod obecné `conflict`. Doménový kód se opakuje v `params`,
 * aby ho `importErrorCode()` našel stejně jako u ostatních chyb importu.
 */
export function assertTransition(from: ImportState, to: ImportState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new ApiError('invalid_state_transition', {
      params: { code: 'invalid_state_transition', from, to, allowed: ALLOWED[from] },
    });
  }
}

export function terminalStateFor(errorRows: number): ImportState {
  return errorRows > 0 ? 'completed_with_errors' : 'completed';
}
