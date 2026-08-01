import { ERROR_CODES } from './registry';

export type ErrorCode = keyof typeof ERROR_CODES & string;
export type Severity = 'error' | 'warning';

export type ValidationIssue = { path: string; code: string; message: string };

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  params?: Record<string, unknown>;
};

export type ApiErrorOptions = {
  /** Strojově čitelné parametry chyby, viz 4.2. */
  params?: Record<string, unknown> | undefined;
  /** Jen pro validation_failed, viz 4.2. Tvar je zmrazený. */
  errors?: ValidationIssue[] | undefined;
  /** Doménové kontroly s víc nálezy naráz, viz 4.2. */
  findings?: Finding[] | undefined;
  /** Sekundy. Smí ho nést každý kód s příznakem opakovatelnosti. */
  retryAfter?: number | undefined;
  /** Interní příčina pro log. Do odpovědi se nikdy nedostane. */
  cause?: unknown;
};

/**
 * Doménová chyba, kterou vrstva HTTP umí přeložit na RFC 9457 odpověď.
 * Nikdy nenese text pro uživatele: ten se skládá až v problem.ts z katalogu,
 * protože závisí na Accept-Language, který doména nezná.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
  // `| undefined` je tu kvůli `exactOptionalPropertyTypes: true` v tsconfigu
  // monorepa: bez něj nejde do volitelného pole přiřadit hodnota, která
  // undefined být může, a přiřazení z `options` by neprošlo překladem.
  readonly params?: Record<string, unknown> | undefined;
  readonly errors?: ValidationIssue[] | undefined;
  readonly findings?: Finding[] | undefined;
  readonly retryAfter?: number | undefined;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    const entry = ERROR_CODES[code];
    if (!entry) {
      throw new Error(
        `ApiError: neregistrovaný kód "${code}". Registruje se v packages/core/src/errors/problem-codes.ts (vlastní P01).`,
      );
    }
    super(code, { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = entry.status;
    this.title = entry.title;
    this.retryable = entry.retryable;
    this.params = options.params;
    this.retryAfter = options.retryAfter;

    if (options.errors && code !== 'validation_failed') {
      throw new Error('ApiError: pole errors patří výhradně ke kódu validation_failed (4.2).');
    }
    this.errors = options.errors;

    if (options.findings) {
      // Pravidlo z 4.2, aby se findings nestal odpadkovým košem: chybová odpověď
      // musí nést aspoň jeden nález, který operaci blokuje. Samotná varování
      // se vracejí s úspěšnou odpovědí.
      if (!options.findings.some((f) => f.severity === 'error')) {
        throw new Error(
          'ApiError: findings v chybové odpovědi musí obsahovat aspoň jeden nález se severity "error" (4.2).',
        );
      }
      this.findings = options.findings;
    }
  }

  /**
   * Vrátí NOVOU chybu se změněnými `params`. Pole třídy jsou readonly schválně:
   * chyba, kterou jde po vyhození přepsat, se nedá spolehlivě zalogovat ani
   * otestovat, protože nikdo neví, jestli se dívá na původní, nebo pozměněný
   * stav. Obohacení (například doplnění kolegů k `forbidden` v úkolu 32) proto
   * vyrábí novou instanci a původní nechává být.
   */
  withParams(params: Record<string, unknown>): ApiError {
    return new ApiError(this.code, {
      params,
      errors: this.errors,
      findings: this.findings,
      retryAfter: this.retryAfter,
      cause: this.cause,
    });
  }
}

export const unauthenticated = (o?: ApiErrorOptions) => new ApiError('unauthenticated', o);
export const invalidCredentials = (o?: ApiErrorOptions) => new ApiError('invalid_credentials', o);
export const sessionExpired = (o?: ApiErrorOptions) => new ApiError('session_expired', o);
export const forbidden = (o?: ApiErrorOptions) => new ApiError('forbidden', o);
export const insufficientScope = (o?: ApiErrorOptions) => new ApiError('insufficient_scope', o);
export const notFound = (o?: ApiErrorOptions) => new ApiError('not_found', o);
export const conflict = (o?: ApiErrorOptions) => new ApiError('conflict', o);
export const alreadyExists = (o?: ApiErrorOptions) => new ApiError('already_exists', o);
export const validationFailed = (errors: ValidationIssue[], o?: Omit<ApiErrorOptions, 'errors'>) =>
  new ApiError('validation_failed', { ...o, errors });
export const internalError = (cause: unknown) => new ApiError('internal_error', { cause });
