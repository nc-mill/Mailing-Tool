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

  it('neznámá chyba spadne na ai_provider_unavailable, ne na prasknutí', () => {
    expect(mapProviderError(new Error('cokoliv')).code).toBe('ai_provider_unavailable');
  });
});
