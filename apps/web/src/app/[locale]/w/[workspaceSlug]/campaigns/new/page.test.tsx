import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Táž brána jako u průvodce importem: kdo nemá `campaigns:write`, se to dozví
 * na vstupu, ne až u uložení. Obrazovka zakládání kampaně se dřív vykreslila
 * komukoli, kdo si napsal adresu `/w/{slug}/campaigns/new`.
 */

const getWorkspaceAccess = vi.fn();
const apiFetch = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/lib/identity/workspace-access', async () => {
  const { can } = await import('@/lib/identity/permissions');
  return {
    getWorkspaceAccess: (slug: string) => getWorkspaceAccess(slug),
    hasPermission: (
      access: { role: 'viewer' | 'editor' | 'admin' | 'owner' },
      permission: string,
    ) => can(access.role, permission as Parameters<typeof can>[1]),
  };
});
vi.mock('@/lib/api-client/fetch', () => ({
  apiFetch: (path: string, options: unknown) => apiFetch(path, options),
}));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/features/campaigns/new-campaign-screen', () => ({
  NewCampaignScreen: () => null,
}));
vi.mock('@/features/settings/forbidden-section', () => ({
  ForbiddenSection: () => null,
}));

const { default: NewCampaignPage } = await import('./page');
const { NewCampaignScreen } = await import('@/features/campaigns/new-campaign-screen');
const { ForbiddenSection } = await import('@/features/settings/forbidden-section');

const WORKSPACE = {
  id: '018f2b1c-0000-7000-8000-000000000001',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
};

function renderPage() {
  return NewCampaignPage({
    params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceAccess.mockResolvedValue({
    ok: true,
    data: { workspace: WORKSPACE, role: 'editor', permissions: [], userName: 'Petr' },
  });
  apiFetch.mockResolvedValue({ ok: true, data: { items: [] } });
});

describe('zakládání kampaně kontroluje oprávnění na vstupu', () => {
  it('prohlížející dostane vysvětlení, ne formulář', async () => {
    getWorkspaceAccess.mockResolvedValue({
      ok: true,
      data: { workspace: WORKSPACE, role: 'viewer', permissions: [], userName: 'Petr' },
    });

    const element = (await renderPage()) as { type: unknown };

    expect(element.type).toBe(ForbiddenSection);
    expect(notFound).not.toHaveBeenCalled();
    // Číselník šablon se pro prohlížejícího ani nenačítá.
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('editor projde na formulář', async () => {
    const element = (await renderPage()) as { type: unknown };

    expect(element.type).toBe(NewCampaignScreen);
  });
});
