import { describe, expect, it, vi } from 'vitest';
import { ReportsApiError, fetchJson } from './api-client';

describe('fetchJson', () => {
  it('posílá If-None-Match a 304 hlásí jako beze změny', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    const result = await fetchJson('/api/v1/dashboard', { etag: 'W/"7"', fetchImpl: fetchMock });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'If-None-Match': 'W/"7"' });
    expect(result).toEqual({ status: 'not_modified' });
  });

  it('vrátí tělo i etag', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ version: 7 }), { status: 200, headers: { ETag: 'W/"7"' } }),
      );
    const result = await fetchJson<{ version: number }>('/api/v1/x', { fetchImpl: fetchMock });
    expect(result).toEqual({ status: 'ok', data: { version: 7 }, etag: 'W/"7"' });
  });

  it('chybu převede na ReportsApiError s kódem a request_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'not_found', request_id: 'req-1' }), {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    await expect(fetchJson('/api/v1/x', { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: 'not_found',
      requestId: 'req-1',
      status: 404,
    });
  });

  it('u odpovědi bez těla nevyhodí výjimku při parsování', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(fetchJson('/api/v1/x', { fetchImpl: fetchMock })).rejects.toBeInstanceOf(
      ReportsApiError,
    );
  });

  // Autentizace API skládá projekt aktéra typu `user` z hlavičky
  // `X-Workspace-Id`, nebo ze segmentu `/w/{slug}` V CESTĚ POŽADAVKU.
  // `/api/v1/**` ale žádný takový segment nemá, takže bez hlavičky
  // middleware vrátí `not_found` (404) na celý požadavek, ne jen na dlaždici.
  // Viz `apps/web/src/lib/api/authenticate.ts:workspaceRefFrom`.
  it('posílá X-Workspace-Id, když je zadané workspaceId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await fetchJson('/api/v1/dashboard', { workspaceId: 'ws-1', fetchImpl: fetchMock });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Workspace-Id': 'ws-1' });
  });

  it('bez workspaceId hlavičku X-Workspace-Id neposílá', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await fetchJson('/api/v1/dashboard', { fetchImpl: fetchMock });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Workspace-Id']).toBeUndefined();
  });
});

/**
 * Odvození projektu z adresy. Klient běží výhradně v prohlížeči, takže je slug
 * vždycky v `location.pathname`, a nemusí se protahovat přes komponenty.
 *
 * Bez toho nepředávalo hlavičku šest volání napříč reporty a každé z nich
 * dostalo 404. Přehled ukázal čtyři chybové dlaždice, přestože na čerstvé
 * instalaci mělo být prostě prázdno.
 */
describe('fetchJson odvozuje projekt z adresy', () => {
  function volani(pathname: string, options: Record<string, unknown> = {}) {
    window.history.replaceState({}, '', pathname);
    // Mock musí mít TÝŽ tvar jako `fetch`, tedy přijímat oba parametry.
    // Bez druhého parametru je `mock.calls[0][1]` typově `undefined` a hlavičky
    // se z něj nedají přečíst, přestože za běhu tam jsou.
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    return { fetchImpl, promise: fetchJson('/api/v1/dashboard', { fetchImpl, ...options }) };
  }

  it('vezme slug z cesty bez jazykové předpony', async () => {
    const { fetchImpl, promise } = volani('/w/e-shop-kolo/');
    await promise;

    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBe('e-shop-kolo');
  });

  it('vezme slug i z cesty s jazykovou předponou', async () => {
    const { fetchImpl, promise } = volani('/cs/w/e-shop-kolo/stats/campaigns');
    await promise;

    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBe('e-shop-kolo');
  });

  it('výslovně předaný projekt má přednost před adresou', async () => {
    const { fetchImpl, promise } = volani('/w/z-adresy/', { workspaceId: 'vyslovny' });
    await promise;

    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBe('vyslovny');
  });

  it('mimo projekt hlavičku neposílá', async () => {
    // Na `/cs/login` žádný projekt není a posílat prázdnou hlavičku by znamenalo
    // říct API „hledej projekt jménem prázdný řetězec".
    const { fetchImpl, promise } = volani('/cs/login');
    await promise;

    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Workspace-Id']).toBeUndefined();
  });
});
