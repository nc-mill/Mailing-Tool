import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Důvod je v komentáři u téhož mocku ve `fetch.test.ts`.
vi.mock('server-only', () => ({}));

vi.mock('./base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

const cookieStore = {
  get: vi.fn(() => ({ name: 'ml_session', value: 'sess' })),
  set: vi.fn(),
};
const requestHeaders = { get: vi.fn(() => null) };

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
  headers: async () => requestHeaders,
}));

vi.mock('@/lib/identity/current-user', () => ({
  getCsrfToken: async () => 'csrf-token-value',
}));

const { apiMutate } = await import('./mutate');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cookieStore.set.mockClear();
});
afterAll(() => server.close());

describe('apiMutate', () => {
  it('posílá Origin, X-CSRF-Token a JSON tělo', async () => {
    let seen: Headers | undefined;
    let body: unknown;
    server.use(
      http.post('http://api.test/api/v1/api-keys', async ({ request }) => {
        seen = request.headers;
        body = await request.json();
        return HttpResponse.json({ id: 'k1' }, { status: 201 });
      }),
    );

    const result = await apiMutate<{ id: string }>('/api/v1/api-keys', {
      method: 'POST',
      body: { name: 'E-shop' },
      workspaceId: 'ws1',
      idempotencyKey: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
    });

    expect(result.ok).toBe(true);
    expect(seen?.get('origin')).toBe('http://api.test');
    expect(seen?.get('x-csrf-token')).toBe('csrf-token-value');
    expect(seen?.get('x-workspace-id')).toBe('ws1');
    expect(seen?.get('idempotency-key')).toBe('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071');
    expect(seen?.get('content-type')).toContain('application/json');
    expect(body).toEqual({ name: 'E-shop' });
  });

  it('u DELETE bez těla neposílá content-type', async () => {
    let seen: Headers | undefined;
    server.use(
      http.delete('http://api.test/api/v1/api-keys/k1', ({ request }) => {
        seen = request.headers;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await apiMutate('/api/v1/api-keys/k1', { method: 'DELETE', workspaceId: 'ws1' });
    expect(seen?.get('content-type')).toBeNull();
  });

  it('posílá X-Reauth-Password, když je zadané', async () => {
    let seen: Headers | undefined;
    server.use(
      http.post('http://api.test/api/v1/workspaces/w1/transfer-ownership', ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({});
      }),
    );
    await apiMutate('/api/v1/workspaces/w1/transfer-ownership', {
      method: 'POST',
      body: { user_id: 'u2' },
      reauthPassword: 'tajne heslo',
    });
    expect(seen?.get('x-reauth-password')).toBe('tajne heslo');
  });

  it('vrátí Problem u 409 idempotency_key_reuse', async () => {
    server.use(
      http.post('http://api.test/api/v1/api-keys', () =>
        HttpResponse.json(
          {
            type: 'https://docs.mlain.dev/errors/idempotency_key_reuse',
            title: 'Idempotency key reused',
            status: 409,
            detail: 'Stejný klíč, jiné tělo.',
            instance: '/api/v1/api-keys',
            code: 'idempotency_key_reuse',
            request_id: 'req_2',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const result = await apiMutate('/api/v1/api-keys', { method: 'POST', body: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('idempotency_key_reuse');
  });

  it('u nedostupné služby vrátí service_unavailable, ne výjimku', async () => {
    server.use(http.post('http://api.test/api/v1/x', () => HttpResponse.error()));
    await expect(apiMutate('/api/v1/x', { method: 'POST', body: {} })).resolves.toMatchObject({
      ok: false,
    });
  });

  // Bez těchhle čtyř testů se přihlášení tváří úspěšně a relace se do
  // prohlížeče nedostane, protože odpověď API není odpovědí pro prohlížeč.
  it('propíše Set-Cookie z přihlášení do odpovědi pro prohlížeč', async () => {
    server.use(
      http.post('http://api.test/api/v1/auth/login', () =>
        HttpResponse.json(
          { user: { id: 'u1' }, workspaces: [] },
          {
            status: 200,
            headers: {
              'set-cookie': 'ml_session=TOKEN; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000',
            },
          },
        ),
      ),
    );

    await apiMutate('/api/v1/auth/login', { method: 'POST', body: { email: 'a@b.cz' } });

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set).toHaveBeenCalledWith({
      name: 'ml_session',
      value: 'TOKEN',
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 2_592_000,
    });
  });

  it('propíše i mazací cookie z odhlášení, aby relace v prohlížeči zmizela', async () => {
    server.use(
      http.post(
        'http://api.test/api/v1/auth/logout',
        () =>
          new HttpResponse(null, {
            status: 204,
            headers: { 'set-cookie': 'ml_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' },
          }),
      ),
    );

    await apiMutate('/api/v1/auth/logout', { method: 'POST' });

    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ml_session', value: '', maxAge: 0 }),
    );
  });

  it('u odpovědi bez Set-Cookie na cookies nesahá', async () => {
    server.use(http.post('http://api.test/api/v1/api-keys', () => HttpResponse.json({ id: 'k1' })));
    await apiMutate('/api/v1/api-keys', { method: 'POST', body: {} });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('cookie propíše i tehdy, když odpověď nese Problem', async () => {
    server.use(
      http.post('http://api.test/api/v1/auth/logout', () =>
        HttpResponse.json(
          {
            type: 'https://docs.mlain.dev/errors/session_expired',
            title: 'Session expired',
            status: 401,
            detail: '',
            instance: '/api/v1/auth/logout',
            code: 'session_expired',
            request_id: 'req_3',
          },
          {
            status: 401,
            headers: {
              'content-type': 'application/problem+json',
              'set-cookie': 'ml_session=; Path=/; Max-Age=0',
            },
          },
        ),
      ),
    );

    const result = await apiMutate('/api/v1/auth/logout', { method: 'POST' });

    expect(result.ok).toBe(false);
    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ml_session', maxAge: 0 }),
    );
  });
});
