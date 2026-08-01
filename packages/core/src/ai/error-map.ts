export type MappedProviderError = {
  code:
    | 'ai_invalid_credentials'
    | 'ai_insufficient_credit'
    | 'ai_rate_limited'
    | 'ai_provider_unavailable'
    | 'ai_timeout'
    | 'ai_context_too_long'
    | 'ai_content_filtered';
  retryable: boolean;
  maxRetries: number;
  retryAfterSeconds?: number;
  backoffSecondsSequence?: readonly number[];
};

type MaybeApiCallError = {
  name?: string;
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
};

function bodyMentions(body: string | undefined, needle: string): boolean {
  return typeof body === 'string' && body.includes(needle);
}

/**
 * Mapa z 3.12.8. Dvě zásady, na kterých se nesleví:
 * 1) `ai_invalid_credentials` a `ai_insufficient_credit` se neopakují nikdy,
 *    protože opakování nepomůže a u placených API je to slušnost.
 * 2) Do výsledku nikdy nejde nic z těla odpovědi providera, protože může
 *    obsahovat identifikátory účtu nebo části promptu.
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

  if (status === 401 || status === 403) {
    return { code: 'ai_invalid_credentials', retryable: false, maxRetries: 0 };
  }
  if (status === 402 || (status === 400 && bodyMentions(body, 'insufficient_quota'))) {
    return { code: 'ai_insufficient_credit', retryable: false, maxRetries: 0 };
  }
  if (status === 429) {
    const header = candidate?.responseHeaders?.['retry-after'];
    const parsed = header === undefined ? Number.NaN : Number.parseInt(header, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { code: 'ai_rate_limited', retryable: true, maxRetries: 2, retryAfterSeconds: parsed };
    }
    return {
      code: 'ai_rate_limited',
      retryable: true,
      maxRetries: 2,
      backoffSecondsSequence: [1, 4],
    };
  }
  if (status === 400 && bodyMentions(body, 'context_length_exceeded')) {
    return { code: 'ai_context_too_long', retryable: false, maxRetries: 0 };
  }
  if (
    status === 400 &&
    (bodyMentions(body, 'content_filter') || bodyMentions(body, 'content_policy'))
  ) {
    return { code: 'ai_content_filtered', retryable: false, maxRetries: 0 };
  }

  return { code: 'ai_provider_unavailable', retryable: true, maxRetries: 2 };
}
