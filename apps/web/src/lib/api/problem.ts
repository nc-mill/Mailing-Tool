import { HTTPException } from 'hono/http-exception';
import { ApiError, type Finding, type ValidationIssue } from '@mlain/core/errors/api-error';
import { resolveDetail } from '@mlain/core/errors/detail-catalog';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** 4.7: URI typu se dogeneruje podle vzorce, nikdy se nevyplňuje ručně. */
const TYPE_BASE = 'https://docs.mlain.dev/errors/';

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: ValidationIssue[];
  findings?: Finding[];
  params?: Record<string, unknown>;
  retry_after?: number;
};

export type ProblemRequest = {
  path: string;
  requestId: string;
  acceptLanguage?: string | null;
};

/** Vezme první jazyk z Accept-Language. Kvalitativní váhy neřešíme, katalogy jsou dva. */
function pickLocale(acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return 'en';
  const first = acceptLanguage.split(',')[0]?.trim().split(';')[0]?.trim();
  return first && first.length > 0 ? first : 'en';
}

/**
 * Rozbité tělo požadavku je chyba KLIENTA, ne serveru.
 *
 * Když tělo není platný JSON (nebo je prázdné a hlavička slibuje JSON), vyhodí
 * validátor Hono `HTTPException` se stavem 400. Ta sem doteď dopadla jako cizí
 * výjimka, takže se z ní stalo `internal_error` 500. Byly s tím tři problémy
 * naráz: volající dostal 5xx, tedy „server je rozbitý, zkus to znovu", ačkoliv
 * měl opravit svůj požadavek; do logu to padalo na úrovni error, takže obyčejný
 * překlep klienta vypadal jako incident; a `openapi.json` u těch operací žádnou
 * odpověď 500 nedeklaruje, takže se dokument rozcházel se skutečností.
 *
 * Mapuje se ÚZCE, jen stav 400, a text z výjimky se ven nepředává. Zpráva od
 * frameworku by mohla nést kus těla požadavku a platí 4.2: ven jde jen
 * registrovaný kód. Volající dostane `validation_failed`, který je u těch
 * operací v dokumentu deklarovaný, s ukazatelem na tělo.
 */
function fromFrameworkError(err: unknown): ApiError | null {
  if (!(err instanceof HTTPException) || err.status !== 400) return null;
  return new ApiError('validation_failed', {
    cause: err,
    errors: [
      {
        path: 'body',
        code: 'invalid_value',
        message: 'Tělo požadavku není platný JSON.',
      },
    ],
  });
}

export function toProblem(
  err: unknown,
  req: ProblemRequest,
): { body: Problem; status: number; headers: Record<string, string> } {
  // 4.2: ven jde vždy registrovaný kód. Cizí výjimka je vždy internal_error,
  // protože její zpráva může obsahovat SQL, název sloupce nebo obsah proměnné.
  const apiErr =
    err instanceof ApiError
      ? err
      : (fromFrameworkError(err) ?? new ApiError('internal_error', { cause: err }));
  const locale = pickLocale(req.acceptLanguage);

  const body: Problem = {
    type: `${TYPE_BASE}${apiErr.code}`,
    title: apiErr.title,
    status: apiErr.status,
    detail: resolveDetail(apiErr.code, locale),
    instance: req.path,
    code: apiErr.code,
    request_id: req.requestId,
  };

  if (apiErr.errors) body.errors = apiErr.errors;
  if (apiErr.findings) body.findings = apiErr.findings;
  if (apiErr.params) body.params = apiErr.params;
  if (apiErr.retryAfter !== undefined) body.retry_after = apiErr.retryAfter;

  const headers: Record<string, string> = { 'Content-Type': PROBLEM_CONTENT_TYPE };
  if (apiErr.retryAfter !== undefined) headers['Retry-After'] = String(apiErr.retryAfter);

  return { body, status: apiErr.status, headers };
}
