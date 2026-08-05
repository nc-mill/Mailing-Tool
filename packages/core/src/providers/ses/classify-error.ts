/**
 * Roztřídění chyby z AWS na důvod, který jde uživateli napsat jako radu.
 *
 * Proč vůbec: `testProviderConnection` u SES posílá ven jediný kód
 * `provider_credentials_invalid`, protože to je jediný registrovaný kód, který
 * na tuhle situaci sedí a smí projít `ApiError`. Jenže „Amazon to odmítl" se
 * opravuje pokaždé jinak: špatný klíč se vymění, chybějící oprávnění se přidá
 * politikou a špatný region se přepíše. Důvod proto jde vedle kódu ve
 * strojově čitelných `params`, kde ho obrazovka přeloží na konkrétní pokyn.
 *
 * Nikdy se netriduje podle textu jako první volba: `name` a `code` jsou stabilní,
 * text zprávy Amazon mění. Text se čte až jako poslední záchrana.
 */
export type SesFailureReason = 'credentials' | 'permissions' | 'region' | 'network' | 'unknown';

/** Jména výjimek, kterými AWS říká „tenhle pár klíčů neznám nebo nesedí podpis". */
const CREDENTIAL_NAMES = new Set([
  'AuthFailure',
  'CredentialsProviderError',
  'IncompleteSignature',
  'InvalidAccessKeyId',
  'InvalidClientTokenId',
  'InvalidSignatureException',
  'MissingAuthenticationToken',
  'SignatureDoesNotMatch',
  'UnrecognizedClientException',
]);

/** Klíč je platný, ale uživatel pod ním nesmí zavolat, na co jsme se ptali. */
const PERMISSION_NAMES = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'AuthorizationError',
  'NotAuthorized',
  'UnauthorizedException',
]);

/** Region neexistuje, nebo v něm SES koncový bod nemá. */
const REGION_NAMES = new Set([
  'ConfigError',
  'EndpointError',
  'InvalidRegionError',
  'UnknownEndpoint',
  'UnrecognizedRegionException',
]);

/** Spojení se vůbec nenavázalo. Není to chyba údajů, je to chyba sítě. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ETIMEDOUT',
]);

const NETWORK_NAMES = new Set(['AbortError', 'RequestTimeout', 'TimeoutError']);

/** Nepřeložené jméno hostitele u endpointu AWS znamená region, který neexistuje. */
const UNRESOLVED_CODES = new Set(['EAI_AGAIN', 'ENOTFOUND']);

function read(err: unknown, key: string): string {
  if (typeof err !== 'object' || err === null) return '';
  const value = (err as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function classifySesError(err: unknown): SesFailureReason {
  const name = read(err, 'name');
  const code = read(err, 'code') || read(err, 'Code');
  const message = read(err, 'message');

  if (CREDENTIAL_NAMES.has(name) || CREDENTIAL_NAMES.has(code)) return 'credentials';
  if (PERMISSION_NAMES.has(name) || PERMISSION_NAMES.has(code)) return 'permissions';
  if (REGION_NAMES.has(name) || REGION_NAMES.has(code)) return 'region';
  if (NETWORK_NAMES.has(name) || NETWORK_CODES.has(code)) return 'network';

  // Nepřeložené jméno se počítá jako region jen tehdy, když jde opravdu o adresu
  // AWS. Jinak je to obyčejný výpadek DNS a rada „opravte region" by mátla.
  if (UNRESOLVED_CODES.has(code)) {
    return /amazonaws\.com/i.test(message) || /amazonaws\.com/i.test(read(err, 'hostname'))
      ? 'region'
      : 'network';
  }

  if (/not authorized to perform|explicit deny|no identity-based policy/i.test(message)) {
    return 'permissions';
  }
  if (/security token|signature|access key/i.test(message)) return 'credentials';
  if (/inaccessible host|could not connect to the endpoint|endpoint url/i.test(message)) {
    return 'region';
  }
  return 'unknown';
}
