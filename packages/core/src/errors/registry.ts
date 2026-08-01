import { FINDING_CODES, PROBLEM_CODES } from './problem-codes';
import { IMPORT_ROW_CODES } from './import-row-codes';
import { MESSAGE_CODES } from './message-codes';
import { OPERATIONAL_CODES } from './operational-codes';
import { REJECTED_CODES } from './rejected-codes';
import { VALIDATION_CODES } from './validation-codes';
import type { AnyCodeEntry, OperationalCodeEntry, ProblemCodeEntry } from './types';

export {
  FINDING_CODES,
  IMPORT_ROW_CODES,
  MESSAGE_CODES,
  OPERATIONAL_CODES,
  PROBLEM_CODES,
  REJECTED_CODES,
  VALIDATION_CODES,
};

/** Základ pro type URI. Nikdy se nevyplňuje ručně (část 1, 4.2). */
export const ERROR_TYPE_BASE = 'https://docs.mlain.dev/errors';

export const ERROR_REGISTRY: Record<string, readonly AnyCodeEntry[]> = {
  problem: PROBLEM_CODES,
  validation: VALIDATION_CODES,
  finding: FINDING_CODES,
  message: MESSAGE_CODES,
  import_row: IMPORT_ROW_CODES,
  operational: OPERATIONAL_CODES,
};

/**
 * Klíč pro kontrolu unikátnosti uvnitř druhu. U pěti původních druhů je to
 * samotný kód; u druhu `operational` dvojice scope a kódu, protože tentýž kód
 * má význam v CLI i v doktoru (`schema_version_ahead`).
 */
export function registryKey(entry: AnyCodeEntry): string {
  return 'scope' in entry ? `${(entry as OperationalCodeEntry).scope}:${entry.code}` : entry.code;
}

const PROBLEM_BY_CODE = new Map(PROBLEM_CODES.map((entry) => [entry.code, entry]));

/**
 * Plochá mapa kořenových kódů podle kódu. Tvar `Record<string, { status,
 * title, retryable }>` si vyžádaly plány P04, P06 a P07, které z něj skládají
 * odpověď API a mapu na překladové klíče.
 *
 * POZOR: obsahuje **jen druh `problem`**, protože jen ten má HTTP status.
 * Na otázku „je tenhle kód vůbec registrovaný" slouží `isRegisteredCode()`
 * nebo `ALL_REGISTERED_CODES`, ne indexace téhle mapy.
 */
export const ERROR_CODES: Readonly<Record<string, ProblemCodeEntry>> = Object.fromEntries(
  PROBLEM_CODES.map((entry) => [entry.code, entry]),
);

/** Každý kód ze všech šesti druhů, bez ohledu na prostor. */
export const ALL_REGISTERED_CODES: ReadonlySet<string> = new Set(
  Object.values(ERROR_REGISTRY).flatMap((entries) => entries.map((entry) => entry.code)),
);

export function typeUri(code: string): string {
  return `${ERROR_TYPE_BASE}/${code}`;
}

export function problemCode(code: string): ProblemCodeEntry {
  const entry = PROBLEM_BY_CODE.get(code);
  if (!entry) {
    throw new Error(
      `Neregistrovaný chybový kód "${code}". Kódy se zakládají výhradně v plánu P01, uzávěr S7.`,
    );
  }
  return entry;
}

export function isRegisteredCode(code: string): boolean {
  return ALL_REGISTERED_CODES.has(code);
}

/** Kód provozního běhu podle scope. Vyhodí, když není registrovaný. */
export function operationalCode(scope: 'cli' | 'doctor', code: string): OperationalCodeEntry {
  const entry = OPERATIONAL_CODES.find((item) => item.scope === scope && item.code === code);
  if (!entry) {
    throw new Error(
      `Neregistrovaný provozní kód "${scope}:${code}". Kódy se zakládají výhradně v plánu P01, uzávěr S7 a rozhodnutí R5.`,
    );
  }
  return entry;
}
