import { describe, expect, it, vi } from 'vitest';
import { REDACTED_HEADERS, createMeteredFetch } from './metered-fetch';

describe('meteredFetch', () => {
  it('propustí požadavek a vrátí odpověď beze změny', async () => {
    const underlying = vi.fn(async () => new Response('ok', { status: 200 }));
    const fetchImpl = createMeteredFetch({ timeoutMs: 1000, fetchImpl: underlying });
    const response = await fetchImpl('https://api.example.com/v1/messages', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('do logu jde metoda, host, stav a doba, nikdy hlavičky ani tělo', async () => {
    const debug = vi.fn();
    const underlying = vi.fn(async () => new Response('{"secret":"x"}', { status: 201 }));
    const fetchImpl = createMeteredFetch({
      timeoutMs: 1000,
      fetchImpl: underlying,
      logger: { debug },
    });
    await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-tajne', 'content-type': 'application/json' },
      body: '{"model":"claude-opus-5"}',
    });
    expect(debug).toHaveBeenCalledTimes(1);
    const [payload] = debug.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload).toMatchObject({ method: 'POST', host: 'api.anthropic.com', status: 201 });
    expect(typeof payload.durationMs).toBe('number');
    const serialized = JSON.stringify(debug.mock.calls);
    expect(serialized).not.toContain('sk-tajne');
    expect(serialized).not.toContain('claude-opus-5');
    expect(serialized).not.toContain('secret');
  });

  it('vynutí timeout přes AbortSignal', async () => {
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const fetchImpl = createMeteredFetch({ timeoutMs: 10, fetchImpl: underlying });
    await expect(fetchImpl('https://api.example.com/x')).rejects.toThrow(/abort/i);
  });

  it('neopakuje: podkladový fetch se volá právě jednou', async () => {
    const underlying = vi.fn(async () => new Response('', { status: 500 }));
    const fetchImpl = createMeteredFetch({ timeoutMs: 1000, fetchImpl: underlying });
    await fetchImpl('https://api.example.com/x');
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('seznam redigovaných hlaviček pokrývá všechny tři providery', () => {
    expect([...REDACTED_HEADERS]).toEqual(['authorization', 'x-api-key', 'x-goog-api-key']);
  });
});
