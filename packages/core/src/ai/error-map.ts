export type MappedProviderErrorCode =
  | 'ai_invalid_credentials'
  | 'ai_insufficient_credit'
  | 'ai_rate_limited'
  | 'ai_provider_unavailable'
  | 'ai_timeout'
  | 'ai_context_too_long'
  | 'ai_content_filtered'
  | 'ai_model_not_found'
  | 'ai_unsupported_parameter'
  | 'ai_request_failed';

export type MappedProviderError = {
  code: MappedProviderErrorCode;
  retryable: boolean;
  maxRetries: number;
  retryAfterSeconds?: number;
  backoffSecondsSequence?: readonly number[];
  /**
   * Stavový kód od poskytovatele, JEN číslo. Slouží k dohledání v logu.
   * Tělo odpovědi se sem nikdy nedostane, viz zásada 2 níž.
   */
  providerStatus?: number;
};

type MaybeApiCallError = {
  name?: string;
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  message?: string;
  cause?: unknown;
};

function bodyMentions(body: string | undefined, needle: string): boolean {
  return typeof body === 'string' && body.includes(needle);
}

/** Kódy, kterými se v Node.js ohlásí síť, ne aplikace. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

/**
 * Pozná selhání spojení: chybu DNS, odmítnuté spojení, vypršelý certifikát.
 * Tohle je jediný případ BEZ stavového kódu, který smí skončit jako výpadek
 * poskytovatele. Cokoliv jiného bez stavového kódu je naše chyba, ne jejich,
 * a tvrdit uživateli opak znamená poslat ho hledat problém na špatné místo.
 */
function isNetworkFailure(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && depth < 5; depth += 1) {
    if (typeof current !== 'object') break;
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && NETWORK_ERROR_CODES.has(candidate.code)) return true;
    if (typeof candidate.message === 'string' && candidate.message.includes('fetch failed')) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** Známky toho, že poskytovatel odmítl PARAMETR požadavku, ne jeho obsah. */
const UNSUPPORTED_PARAMETER_MARKERS = [
  'unsupported_parameter',
  'unsupported_value',
  'unknown_parameter',
  'unrecognized_keys',
  'invalid_parameter',
];

/**
 * Mapa z 3.12.8. Tři zásady, na kterých se nesleví:
 * 1) `ai_invalid_credentials` a `ai_insufficient_credit` se neopakují nikdy,
 *    protože opakování nepomůže a u placených API je to slušnost.
 * 2) Do výsledku nikdy nejde nic z těla odpovědi providera, protože může
 *    obsahovat identifikátory účtu nebo části promptu. Číslo stavového kódu
 *    tělo není a do logu ho potřebujeme, proto jde ven jako `providerStatus`.
 * 3) VÝPADEK JE JEN TO, CO JE OPRAVDU VÝPADEK: chyba 5xx nebo selhání spojení.
 *    Cokoliv jiného, čemu nerozumíme, končí jako `ai_request_failed`. Dřív tu
 *    byl výpadek jako výchozí hodnota, takže se jako „služba má výpadek"
 *    tvářila i chyba 404 na neznámý model nebo naše vlastní výjimka, a uživatel
 *    hledal příčinu u poskytovatele, kde žádná nebyla.
 */
export function mapProviderError(error: unknown): MappedProviderError {
  if (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return { code: 'ai_timeout', retryable: false, maxRetries: 0 };
  }

  const candidate = error as MaybeApiCallError | null;
  const status = candidate?.statusCode;
  const body = candidate?.responseBody;
  const withStatus = status === undefined ? {} : { providerStatus: status };

  if (status === 401 || status === 403) {
    return { code: 'ai_invalid_credentials', retryable: false, maxRetries: 0, ...withStatus };
  }
  if (status === 402 || (status === 400 && bodyMentions(body, 'insufficient_quota'))) {
    return { code: 'ai_insufficient_credit', retryable: false, maxRetries: 0, ...withStatus };
  }
  if (status === 429) {
    const header = candidate?.responseHeaders?.['retry-after'];
    const parsed = header === undefined ? Number.NaN : Number.parseInt(header, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return {
        code: 'ai_rate_limited',
        retryable: true,
        maxRetries: 2,
        retryAfterSeconds: parsed,
        ...withStatus,
      };
    }
    return {
      code: 'ai_rate_limited',
      retryable: true,
      maxRetries: 2,
      backoffSecondsSequence: [1, 4],
      ...withStatus,
    };
  }
  if (status === 400 && bodyMentions(body, 'context_length_exceeded')) {
    return { code: 'ai_context_too_long', retryable: false, maxRetries: 0, ...withStatus };
  }
  if (
    status === 400 &&
    (bodyMentions(body, 'content_filter') || bodyMentions(body, 'content_policy'))
  ) {
    return { code: 'ai_content_filtered', retryable: false, maxRetries: 0, ...withStatus };
  }

  /*
   * Chybějící nebo nepodporovaný model. Poskytovatelé ho hlásí jako 404, někdy
   * jako 400 s `model_not_found` v těle. Opakovat nemá smysl: dokud uživatel
   * nezmění název modelu v nastavení AI, dopadne to stejně.
   */
  if (status === 404 || bodyMentions(body, 'model_not_found')) {
    return { code: 'ai_model_not_found', retryable: false, maxRetries: 0, ...withStatus };
  }

  // Odmítnutý parametr požadavku. Typicky model, který neumí strukturovaný
  // výstup nebo volání nástrojů; jiný model to vyřeší, opakování ne.
  if (
    status === 400 &&
    UNSUPPORTED_PARAMETER_MARKERS.some((marker) => bodyMentions(body, marker))
  ) {
    return { code: 'ai_unsupported_parameter', retryable: false, maxRetries: 0, ...withStatus };
  }

  // Skutečný výpadek: buď to řekne poskytovatel sám (5xx), nebo se k němu
  // vůbec nedovoláme (DNS, odmítnuté spojení, TLS).
  if ((status !== undefined && status >= 500) || isNetworkFailure(error)) {
    return { code: 'ai_provider_unavailable', retryable: true, maxRetries: 2, ...withStatus };
  }

  return { code: 'ai_request_failed', retryable: false, maxRetries: 0, ...withStatus };
}
