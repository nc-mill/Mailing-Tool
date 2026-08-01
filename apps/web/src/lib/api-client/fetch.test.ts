import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// ODCHYLKA OD PLÁNU, vynucená spuštěním. Balíček `server-only` má v mapě
// `exports` podmínku `react-server` na prázdný modul a `default` na modul,
// který PŘI IMPORTU vyhodí výjimku. Vitest podmínku `react-server` nemá,
// takže by import `./fetch` skončil hláškou o klientské komponentě. Aliasovat
// se to dá jen ve `vitest.config.ts`, který vlastní P01. Mock je jediné místo,
// kam smí sáhnout P06, a značku v produkčním kódu nechává být.
vi.mock('server-only', () => ({}));

vi.mock('./base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

const cookieStore = { get: vi.fn() };
const requestHeaders = { get: vi.fn() };

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));

const { apiFetch, buildUrl } = await import('./fetch');

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cookieStore.get.mockReset();
  requestHeaders.get.mockReset();
});
afterAll(() => server.close());

describe('buildUrl', () => {
  it('poskládá absolutní adresu a vynechá nedefinované parametry', () => {
    expect(buildUrl('/api/v1/members', { limit: 50, cursor: undefined, role: 'admin' })).toBe(
      'http://api.test/api/v1/members?limit=50&role=admin',
    );
  });

  it('bez parametrů nepřidá otazník', () => {
    expect(buildUrl('/api/v1/members', {})).toBe('http://api.test/api/v1/members');
  });
});

describe('apiFetch', () => {
  it('vrátí data u 200', async () => {
    server.use(
      http.get('http://api.test/api/v1/members', () => HttpResponse.json({ data: [{ id: 'a' }] })),
    );
    const result = await apiFetch<{ data: Array<{ id: string }> }>('/api/v1/members');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.data[0]!.id).toBe('a');
  });

  it('vrátí undefined u 204', async () => {
    server.use(http.get('http://api.test/api/v1/x', () => new HttpResponse(null, { status: 204 })));
    const result = await apiFetch<void>('/api/v1/x');
    expect(result.ok).toBe(true);
  });

  it('přeposílá session cookie, Accept-Language a X-Workspace-Id', async () => {
    cookieStore.get.mockReturnValue({ name: 'ml_session', value: 'abc123' });
    requestHeaders.get.mockImplementation((name: string) =>
      name === 'accept-language' ? 'cs-CZ,cs;q=0.9' : null,
    );
    let seen: Headers | undefined;
    server.use(
      http.get('http://api.test/api/v1/members', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({ data: [] });
      }),
    );

    await apiFetch('/api/v1/members', { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071' });

    expect(seen?.get('cookie')).toBe('ml_session=abc123');
    expect(seen?.get('accept-language')).toBe('cs-CZ,cs;q=0.9');
    expect(seen?.get('x-workspace-id')).toBe('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071');
    expect(seen?.get('accept')).toBe('application/json');
  });

  it('bez session cookie neposílá hlavičku cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);
    let seen: Headers | undefined;
    server.use(
      http.get('http://api.test/api/v1/x', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({});
      }),
    );
    await apiFetch('/api/v1/x');
    expect(seen?.get('cookie')).toBeNull();
  });

  it('vrátí Problem u application/problem+json', async () => {
    server.use(
      http.get('http://api.test/api/v1/api-keys', () =>
        HttpResponse.json(
          {
            type: 'https://docs.mlain.dev/errors/forbidden',
            title: 'Forbidden',
            status: 403,
            detail: 'Nemáte oprávnění.',
            instance: '/api/v1/api-keys',
            code: 'forbidden',
            request_id: 'req_1',
            params: { requiredPermission: 'api_keys:read', currentRole: 'viewer' },
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const result = await apiFetch('/api/v1/api-keys');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe('forbidden');
      expect(result.problem.request_id).toBe('req_1');
      expect(result.problem.params).toEqual({
        requiredPermission: 'api_keys:read',
        currentRole: 'viewer',
      });
    }
  });

  it('u chyby bez problem+json vyrobí internal_error s prázdným request_id', async () => {
    server.use(
      http.get('http://api.test/api/v1/x', () => new HttpResponse('nginx', { status: 502 })),
    );
    const result = await apiFetch('/api/v1/x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe('internal_error');
      expect(result.problem.request_id).toBe('');
    }
  });

  it('u nedostupné služby vrátí service_unavailable, ne výjimku', async () => {
    server.use(http.get('http://api.test/api/v1/x', () => HttpResponse.error()));
    const result = await apiFetch('/api/v1/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('u vypršeného času vrátí dependency_timeout', async () => {
    server.use(
      http.get('http://api.test/api/v1/slow', async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );
    const result = await apiFetch('/api/v1/slow', { timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('dependency_timeout');
  });

  it('nikdy nevyhodí výjimku, ani když tělo není JSON', async () => {
    server.use(
      http.get(
        'http://api.test/api/v1/broken',
        () =>
          new HttpResponse('{', {
            status: 422,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    );
    await expect(apiFetch('/api/v1/broken')).resolves.toMatchObject({ ok: false });
  });
});
