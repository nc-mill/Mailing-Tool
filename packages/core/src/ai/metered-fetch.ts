export const REDACTED_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key'] as const;

export type MeteredFetchLogger = {
  debug: (payload: Record<string, unknown>, message: string) => void;
};

export type MeteredFetchOptions = {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  logger?: MeteredFetchLogger;
};

/**
 * Obálka nad `fetch` pro volání AI providerů. Dělá čtyři věci a nic jiného:
 * vynutí timeout, změří dobu, zaloguje metodu, host, stav a dobu, a nezvyšuje
 * počet pokusů. Opakování řeší AI SDK přes `maxRetries` (3.12.8); dvě vrstvy
 * opakování by násobily náklady uživatele.
 */
export function createMeteredFetch(options: MeteredFetchOptions): typeof fetch {
  const { timeoutMs, fetchImpl = fetch, logger } = options;

  return async function meteredFetch(input, init) {
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      init?.signal === undefined || init.signal === null
        ? timeoutSignal
        : AbortSignal.any([init.signal, timeoutSignal]);

    let host = 'unknown';
    try {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      host = url.host;
    } catch {
      host = 'unparsable';
    }

    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

    try {
      const response = await fetchImpl(input, { ...init, signal });
      logger?.debug(
        { method, host, status: response.status, durationMs: Date.now() - startedAt },
        'ai provider request',
      );
      return response;
    } catch (error) {
      logger?.debug(
        { method, host, status: 0, durationMs: Date.now() - startedAt },
        'ai provider request failed',
      );
      throw error;
    }
  };
}
