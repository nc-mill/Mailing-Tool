/**
 * Klíč překladu se nesmí skládat za běhu (kritérium 71 části 6 a konvence 3.9
 * části 1). Tahle mapa je jediné povolené spojení mezi kódem chyby a textem.
 * Kód, který v mapě není, spadne na `detail` ze serveru, viz kritérium 76.
 *
 * Klíče jsou relativní k namespace, protože obrazovky používají
 * `useTranslations('auth')` nebo `useTranslations('settings')`.
 */
export type ErrorTextKeys = { readonly title: string; readonly body: string };

export const AUTH_ERROR_KEYS = {
  invalid_credentials: {
    title: 'errors.invalidCredentials.title',
    body: 'errors.invalidCredentials.body',
  },
  account_locked: { title: 'errors.accountLocked.title', body: 'errors.accountLocked.body' },
  rate_limited: { title: 'errors.rateLimited.title', body: 'errors.rateLimited.body' },
  unauthenticated: { title: 'errors.unauthenticated.title', body: 'errors.unauthenticated.body' },
  session_expired: { title: 'errors.sessionExpired.title', body: 'errors.sessionExpired.body' },
  setup_already_completed: {
    title: 'errors.setupAlreadyCompleted.title',
    body: 'errors.setupAlreadyCompleted.body',
  },
  validation_failed: {
    title: 'errors.validationFailed.title',
    body: 'errors.validationFailed.body',
  },
  not_found: { title: 'errors.notFound.title', body: 'errors.notFound.body' },
  gone: { title: 'errors.gone.title', body: 'errors.gone.body' },
  service_unavailable: {
    title: 'errors.serviceUnavailable.title',
    body: 'errors.serviceUnavailable.body',
  },
  dependency_timeout: {
    title: 'errors.dependencyTimeout.title',
    body: 'errors.dependencyTimeout.body',
  },
  internal_error: { title: 'errors.internalError.title', body: 'errors.internalError.body' },
} as const satisfies Record<string, ErrorTextKeys>;

export const SETTINGS_ERROR_KEYS = {
  forbidden: { title: 'errors.forbidden.title', body: 'errors.forbidden.body' },
  insufficient_scope: {
    title: 'errors.insufficientScope.title',
    body: 'errors.insufficientScope.body',
  },
  origin_not_allowed: {
    title: 'errors.originNotAllowed.title',
    body: 'errors.originNotAllowed.body',
  },
  csrf_token_invalid: {
    title: 'errors.csrfTokenInvalid.title',
    body: 'errors.csrfTokenInvalid.body',
  },
  session_expired: { title: 'errors.sessionExpired.title', body: 'errors.sessionExpired.body' },
  not_found: { title: 'errors.notFound.title', body: 'errors.notFound.body' },
  conflict: { title: 'errors.conflict.title', body: 'errors.conflict.body' },
  already_exists: { title: 'errors.alreadyExists.title', body: 'errors.alreadyExists.body' },
  already_member: { title: 'errors.alreadyMember.title', body: 'errors.alreadyMember.body' },
  last_owner_cannot_be_removed: { title: 'errors.lastOwner.title', body: 'errors.lastOwner.body' },
  idempotency_key_reuse: {
    title: 'errors.idempotencyKeyReuse.title',
    body: 'errors.idempotencyKeyReuse.body',
  },
  idempotency_request_in_progress: {
    title: 'errors.idempotencyInProgress.title',
    body: 'errors.idempotencyInProgress.body',
  },
  validation_failed: {
    title: 'errors.validationFailed.title',
    body: 'errors.validationFailed.body',
  },
  too_many_items: { title: 'errors.tooManyItems.title', body: 'errors.tooManyItems.body' },
  rate_limited: { title: 'errors.rateLimited.title', body: 'errors.rateLimited.body' },
  webhook_endpoint_disabled: {
    title: 'errors.webhookDisabled.title',
    body: 'errors.webhookDisabled.body',
  },
  service_unavailable: {
    title: 'errors.serviceUnavailable.title',
    body: 'errors.serviceUnavailable.body',
  },
  dependency_timeout: {
    title: 'errors.dependencyTimeout.title',
    body: 'errors.dependencyTimeout.body',
  },
  internal_error: { title: 'errors.internalError.title', body: 'errors.internalError.body' },
} as const satisfies Record<string, ErrorTextKeys>;

export type ErrorKeyMap = Record<string, ErrorTextKeys>;

export function errorTextKeys(map: ErrorKeyMap, code: string): ErrorTextKeys | undefined {
  return Object.hasOwn(map, code) ? map[code] : undefined;
}
