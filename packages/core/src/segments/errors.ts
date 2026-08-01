import { ApiError } from '../errors/api-error';

/**
 * Doménové kódy segmentů. Kořenové `code` odpovědi je vždy obecné z registru P01
 * (rozhodnutí R17 plánu), doménový kód jde do `errors[].code` a zároveň do
 * `params.code`, aby se dal přečíst i u kódů, které pole `errors` nést nesmějí.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal
 * `new ApiError('validation_failed', 422, { errors: [...] })`, tedy tříparametrový
 * konstruktor se stavem uprostřed. Skutečný `ApiError` z P01 má podpis
 * `(code, options)`, status si bere z registru a pole `errors` povoluje VÝHRADNĚ
 * u kódu `validation_failed` (kontroluje to sám konstruktor a jinak vyhodí).
 * Kód `too_many_items` proto nese doménový kód v `params`, ne v `errors`.
 *
 * `ValidationIssue` má navíc povinné `message` a žádné `meta`, takže podrobnosti
 * jdou do `params`. Text zprávy je anglický a strojový: uživatelský text skládá
 * až vrstva HTTP z katalogu, doména jazyk klienta nezná.
 */
export type SegmentErrorCode =
  | 'segment_invalid_ast'
  | 'segment_operator_not_allowed'
  | 'segment_invalid_range'
  | 'segment_too_complex'
  | 'segment_too_deep'
  | 'segment_too_many_engagement'
  | 'segment_too_many_event'
  | 'segment_nesting_too_deep'
  | 'segment_cycle'
  | 'segment_list_too_long'
  | 'segment_definition_too_large'
  | 'segment_reference_not_found'
  | 'segment_preview_timeout'
  | 'audience_empty'
  | 'cross_workspace_scan_blocked';

/**
 * Doménový kód z jakékoli chyby segmentů. Testy se ptají tudy, ne přes
 * `error.message`: zpráva `ApiError` je kořenové `code`, tedy `validation_failed`,
 * a regulární výraz nad ní by doménový kód nikdy nenašel.
 */
export function segmentErrorCode(error: unknown): string | undefined {
  const params = (error as { params?: Record<string, unknown> } | undefined)?.params;
  const code = params?.['code'];
  if (typeof code === 'string') return code;
  const issues = (error as { errors?: { code?: string }[] } | undefined)?.errors;
  return issues?.[0]?.code;
}

/** Chyba tvaru AST nebo hodnoty. Kořenové `code` je `validation_failed`. */
export function invalidAst(
  path: string,
  code: SegmentErrorCode,
  message: string,
  meta: Record<string, unknown> = {},
): never {
  throw new ApiError('validation_failed', {
    errors: [{ path, code, message }],
    params: { code, ...meta },
  });
}

/** Překročený limit složitosti. `too_many_items` pole `errors` nést nesmí. */
export function tooMany(code: SegmentErrorCode, meta: Record<string, unknown> = {}): never {
  throw new ApiError('too_many_items', { params: { code, ...meta } });
}

/** Cizí nebo neexistující odkaz. Nikdy prázdný výsledek, vždy 404. */
export function referenceNotFound(kind: string, id: string): never {
  throw new ApiError('not_found', {
    params: { code: 'segment_reference_not_found', kind, id },
  });
}
