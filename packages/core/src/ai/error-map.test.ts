import { describe, expect, it } from 'vitest';
import { mapProviderError } from './error-map';

const apiCallError = (init: {
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  name?: string;
}) => Object.assign(new Error('provider failed'), { name: 'AI_APICallError', ...init });

describe('mapování chyb providerů', () => {
  it('401 a 403 jsou neplatný klíč a neopakují se', () => {
    for (const statusCode of [401, 403]) {
      const mapped = mapProviderError(apiCallError({ statusCode }));
      expect(mapped.code).toBe('ai_invalid_credentials');
      expect(mapped.retryable).toBe(false);
    }
  });

  it('402 je došlý kredit', () => {
    expect(mapProviderError(apiCallError({ statusCode: 402 })).code).toBe('ai_insufficient_credit');
  });

  it('400 s insufficient_quota je také došlý kredit', () => {
    const mapped = mapProviderError(
      apiCallError({ statusCode: 400, responseBody: '{"error":{"code":"insufficient_quota"}}' }),
    );
    expect(mapped.code).toBe('ai_insufficient_credit');
    expect(mapped.retryable).toBe(false);
  });

  it('429 s Retry-After se opakuje nejvýše dvakrát a nese odklad', () => {
    const mapped = mapProviderError(
      apiCallError({ statusCode: 429, responseHeaders: { 'retry-after': '20' } }),
    );
    expect(mapped.code).toBe('ai_rate_limited');
    expect(mapped.retryable).toBe(true);
    expect(mapped.maxRetries).toBe(2);
    expect(mapped.retryAfterSeconds).toBe(20);
  });

  it('429 bez Retry-After má exponenciální odklad 1 a 4 sekundy', () => {
    const mapped = mapProviderError(apiCallError({ statusCode: 429 }));
    expect(mapped.code).toBe('ai_rate_limited');
    expect(mapped.backoffSecondsSequence).toEqual([1, 4]);
  });

  it('500, 502, 503 a 529 jsou výpadek providera', () => {
    for (const statusCode of [500, 502, 503, 529]) {
      const mapped = mapProviderError(apiCallError({ statusCode }));
      expect(mapped.code).toBe('ai_provider_unavailable');
      expect(mapped.retryable).toBe(true);
      expect(mapped.maxRetries).toBe(2);
    }
  });

  it('AbortError z timeoutu je ai_timeout a neopakuje se', () => {
    const mapped = mapProviderError(new DOMException('aborted', 'TimeoutError'));
    expect(mapped.code).toBe('ai_timeout');
    expect(mapped.retryable).toBe(false);
  });

  it('400 s context_length_exceeded je příliš dlouhé zadání', () => {
    const mapped = mapProviderError(
      apiCallError({
        statusCode: 400,
        responseBody: '{"error":{"code":"context_length_exceeded"}}',
      }),
    );
    expect(mapped.code).toBe('ai_context_too_long');
  });

  it('400 s filtrací obsahu je ai_content_filtered', () => {
    const mapped = mapProviderError(
      apiCallError({ statusCode: 400, responseBody: '{"error":{"type":"content_filter"}}' }),
    );
    expect(mapped.code).toBe('ai_content_filtered');
  });

  it('syrová odpověď providera se do výsledku nikdy nedostane', () => {
    const mapped = mapProviderError(
      apiCallError({
        statusCode: 400,
        responseBody: '{"error":{"code":"insufficient_quota"},"account_id":"acct_tajne"}',
      }),
    );
    expect(JSON.stringify(mapped)).not.toContain('acct_tajne');
  });

  /*
   * Tahle skupina hlídá vadu, kvůli které vznikla: výpadek poskytovatele byl
   * VÝCHOZÍ HODNOTOU mapy, takže se jako „služba má výpadek" tvářilo úplně
   * všechno, čemu jsme nerozuměli. Uživatel s funkčním klíčem viděl hlášku
   * o výpadku OpenAI a hledal chybu tam, kde žádná nebyla.
   */
  it('404 je neznámý model, ne výpadek, a neopakuje se', () => {
    const mapped = mapProviderError(apiCallError({ statusCode: 404 }));
    expect(mapped.code).toBe('ai_model_not_found');
    expect(mapped.retryable).toBe(false);
    expect(mapped.providerStatus).toBe(404);
  });

  it('400 s model_not_found je také neznámý model', () => {
    expect(
      mapProviderError(
        apiCallError({ statusCode: 400, responseBody: '{"error":{"code":"model_not_found"}}' }),
      ).code,
    ).toBe('ai_model_not_found');
  });

  it('400 s odmítnutým parametrem je ai_unsupported_parameter, ne výpadek', () => {
    for (const marker of ['unsupported_parameter', 'unsupported_value', 'unknown_parameter']) {
      const mapped = mapProviderError(
        apiCallError({ statusCode: 400, responseBody: `{"error":{"code":"${marker}"}}` }),
      );
      expect(mapped.code).toBe('ai_unsupported_parameter');
      expect(mapped.retryable).toBe(false);
    }
  });

  it('neznámá chyba bez stavového kódu NENÍ výpadek poskytovatele', () => {
    const mapped = mapProviderError(new Error('cokoliv'));
    expect(mapped.code).toBe('ai_request_failed');
    expect(mapped.code).not.toBe('ai_provider_unavailable');
    expect(mapped.retryable).toBe(false);
  });

  it('neošetřený stav 4xx NENÍ výpadek poskytovatele', () => {
    for (const statusCode of [409, 413, 422]) {
      expect(mapProviderError(apiCallError({ statusCode })).code).toBe('ai_request_failed');
    }
  });

  it('selhání spojení výpadek JE, i když stavový kód chybí', () => {
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), {
        code: 'ENOTFOUND',
      }),
    });
    const mapped = mapProviderError(dns);
    expect(mapped.code).toBe('ai_provider_unavailable');
    expect(mapped.retryable).toBe(true);
  });

  it('stavový kód poskytovatele je ve výsledku, tělo odpovědi nikdy', () => {
    const mapped = mapProviderError(
      apiCallError({ statusCode: 404, responseBody: '{"model":"tajny-model","org":"org_tajne"}' }),
    );
    expect(mapped.providerStatus).toBe(404);
    expect(JSON.stringify(mapped)).not.toContain('org_tajne');
  });
});
