import { describe, expect, it, vi } from 'vitest';

// Důvod je v komentáři u téhož mocku ve `fetch.test.ts`.
vi.mock('server-only', () => ({}));

const apiFetch = vi.fn();
vi.mock('@/lib/api-client/fetch', () => ({ apiFetch }));

const getCurrentUser = vi.fn();
vi.mock('./current-user', () => ({ getCurrentUser }));

const { getWorkspaceAccess, hasPermission } = await import('./workspace-access');

const WORKSPACE = {
  id: 'ws1',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  locale: 'cs',
  timezone: 'Europe/Prague',
  address_form: 'formal' as const,
  created_at: '2026-01-01T00:00:00.000Z',
};

describe('getWorkspaceAccess', () => {
  it('vrátí projekt, roli a odvozená oprávnění', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: {
        user: {
          id: 'u1',
          name: 'Jana Nováková',
          email: 'jana@firma.cz',
          locale: 'cs',
          timezone: 'Europe/Prague',
        },
        memberships: [
          { workspace_id: 'ws1', slug: 'eshop-kolo', name: 'E-shop Kolo', role: 'admin' },
        ],
        csrf_token: 'c',
      },
    });
    apiFetch.mockResolvedValue({ ok: true, data: { workspace: WORKSPACE } });

    const result = await getWorkspaceAccess('eshop-kolo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.role).toBe('admin');
      expect(hasPermission(result.data, 'api_keys:read')).toBe(true);
      expect(hasPermission(result.data, 'backups:read')).toBe(false);
      expect(result.data.userName).toBe('Jana Nováková');
    }
  });

  it('nečlenovi vrátí 404, ne 403', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: {
        user: { id: 'u1', name: '', email: 'x@y.cz', locale: 'cs', timezone: 'UTC' },
        memberships: [],
        csrf_token: 'c',
      },
    });
    const result = await getWorkspaceAccess('cizi-projekt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.status).toBe(404);
      expect(result.problem.code).toBe('not_found');
    }
  });

  it('chybu z /auth/me propustí beze změny', async () => {
    getCurrentUser.mockResolvedValue({
      ok: false,
      problem: {
        status: 503,
        code: 'service_unavailable',
        request_id: '',
        type: '',
        title: '',
        detail: '',
        instance: '',
      },
    });
    const result = await getWorkspaceAccess('eshop-kolo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('u uživatele bez jména použije e-mail', async () => {
    getCurrentUser.mockResolvedValue({
      ok: true,
      data: {
        user: {
          id: 'u1',
          name: '',
          email: 'petr@firma.cz',
          locale: 'cs',
          timezone: 'Europe/Prague',
        },
        memberships: [{ workspace_id: 'ws1', slug: 'eshop-kolo', name: 'E', role: 'owner' }],
        csrf_token: 'c',
      },
    });
    apiFetch.mockResolvedValue({ ok: true, data: { workspace: WORKSPACE } });
    const result = await getWorkspaceAccess('eshop-kolo');
    if (result.ok) expect(result.data.userName).toBe('petr@firma.cz');
  });
});
