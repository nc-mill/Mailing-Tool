import { describe, expect, it, vi } from 'vitest';

// Důvod je v komentáři u téhož mocku ve `fetch.test.ts`.
vi.mock('server-only', () => ({}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const getCurrentUser = vi.fn();
vi.mock('./current-user', () => ({ getCurrentUser }));

const { requireUser } = await import('./require-user');

const problem = (status: number, code: string) => ({
  type: `https://docs.mlain.dev/errors/${code}`,
  title: code,
  status,
  detail: '',
  instance: '/api/v1/auth/me',
  code,
  request_id: 'req_1',
});

describe('requireUser', () => {
  it('vrátí uživatele, když je přihlášený', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: { user: { id: 'u1' }, memberships: [], csrf_token: 'c' },
    });
    const result = await requireUser('/settings/profile');
    expect(result.ok).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('u 401 přesměruje na přihlášení a zachová cílovou adresu', async () => {
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(401, 'unauthenticated') });
    await expect(requireUser('/w/eshop/settings/members?role=admin')).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fw%2Feshop%2Fsettings%2Fmembers%3Frole%3Dadmin',
    );
  });

  it('u vypršené relace přesměruje také', async () => {
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(401, 'session_expired') });
    await expect(requireUser('/x')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fx');
  });

  it('u jiné chyby nepřesměruje a vrátí Problem, aby obrazovka ukázala stav S9', async () => {
    redirect.mockClear();
    getCurrentUser.mockResolvedValue({ ok: false, problem: problem(503, 'service_unavailable') });
    const result = await requireUser('/x');
    expect(result.ok).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});
