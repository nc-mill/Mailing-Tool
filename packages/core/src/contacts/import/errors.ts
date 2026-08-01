import { ApiError } from '../../errors/api-error';

/**
 * Doménové kódy importu a exportu. Kořenové `code` odpovědi je vždy obecné
 * z registru P01 (rozhodnutí R17 plánu), doménový kód jde do `errors[].code`
 * a zároveň do `params.code`, aby se dal přečíst i u kódů, které pole `errors`
 * nést nesmějí.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal
 * `new ApiError('validation_failed', 422, { errors: [{ path, code, meta }] })`.
 * Skutečný `ApiError` z P01 má podpis `(code, options)`, status si bere
 * z registru, pole `errors` povoluje VÝHRADNĚ u kódu `validation_failed`
 * a `ValidationIssue` má povinné `message` a žádné `meta`. Podrobnosti proto
 * jdou do `params`. Je to táž úprava, jakou si vynutily segmenty.
 */
export type ImportErrorCode =
  | 'file_too_large'
  | 'empty_file'
  | 'unsupported_encoding'
  | 'delimiter_not_detected'
  | 'no_email_column_mapped'
  | 'duplicate_target'
  | 'declaration_required'
  | 'duplicate_error_unavailable'
  | 'import_duplicate'
  | 'import_already_running'
  | 'import_not_found'
  | 'export_already_running'
  | 'export_not_found'
  | 'invalid_state_transition'
  | 'cross_workspace_scan_blocked';

/**
 * Doménový kód z jakékoli chyby importu. Testy se ptají tudy, ne přes
 * `error.message`: zpráva `ApiError` je kořenové `code`, tedy třeba
 * `validation_failed`, a doménový kód by v ní nikdo nenašel.
 */
export function importErrorCode(error: unknown): string | undefined {
  const params = (error as { params?: Record<string, unknown> } | undefined)?.params;
  const code = params?.['code'];
  if (typeof code === 'string') return code;
  const issues = (error as { errors?: { code?: string }[] } | undefined)?.errors;
  return issues?.[0]?.code;
}

/** Chyba vstupu. Kořenové `code` je `validation_failed`, tedy 422. */
export function invalidImport(
  path: string,
  code: ImportErrorCode,
  message: string,
  meta: Record<string, unknown> = {},
): never {
  throw new ApiError('validation_failed', {
    errors: [{ path, code, message }],
    params: { code, ...meta },
  });
}

/** Soubor nad limitem. `payload_too_large` pole `errors` nést nesmí. */
export function tooLarge(actualBytes: number, limitBytes: number): never {
  throw new ApiError('payload_too_large', {
    params: { code: 'file_too_large', actualBytes, limitBytes },
  });
}

/** Kolize idempotence nebo zakázaný přechod stavu. */
export function conflictImport(code: ImportErrorCode, meta: Record<string, unknown> = {}): never {
  throw new ApiError('conflict', { params: { code, ...meta } });
}

/** Jeden běžící import (nebo export) na projekt. */
export function lockedImport(code: ImportErrorCode, meta: Record<string, unknown> = {}): never {
  throw new ApiError('resource_locked', { params: { code, ...meta } });
}

/** Import nebo export, který v projektu neexistuje. Nikdy prázdný výsledek, vždy 404. */
export function notFoundImport(code: ImportErrorCode, id: string): never {
  throw new ApiError('not_found', { params: { code, id } });
}
