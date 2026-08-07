import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Brána nad tím, že se prohlížející dozví o chybějícím oprávnění NA ZAČÁTKU
 * průvodce, ne až u uložení.
 *
 * Průvodce importem se dřív vykreslil komukoli, kdo si napsal adresu
 * `/w/{slug}/contacts/import`. Prohlížející prošel nahrání souboru, kontrolu,
 * mapování sloupců i náhled a odmítnutí dostal až od API v posledním kroku.
 *
 * Test nekontroluje vzhled, ale ROZHODNUTÍ: bez `contacts:import` se vrací
 * vysvětlení (S11), s ním průvodce.
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
    // Skutečná implementace, ne další mock: kdyby se matice oprávnění změnila,
    // test to má poznat.
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
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/features/import/import-wizard', () => ({
  ImportWizard: () => null,
}));
vi.mock('@/features/settings/forbidden-section', () => ({
  ForbiddenSection: () => null,
}));

const { default: ImportPage } = await import('./page');
const { ImportWizard } = await import('@/features/import/import-wizard');
const { ForbiddenSection } = await import('@/features/settings/forbidden-section');

const WORKSPACE = {
  id: '018f2b1c-0000-7000-8000-000000000001',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  greeting_enabled: true,
};

function renderPage() {
  return ImportPage({
    params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo' }),
    searchParams: Promise.resolve({}),
  });
}

/**
 * Typy komponent v návratovém stromu. Stránka vrací fragment s odkazem
 * a průvodcem, nebo samotné vysvětlení; hledá se tedy v celém stromu.
 */
function typesIn(node: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) typesIn(child, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.type !== undefined) found.push(element.type);
  if (element.props?.children !== undefined) typesIn(element.props.children, found);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceAccess.mockResolvedValue({
    ok: true,
    data: { workspace: WORKSPACE, role: 'editor', permissions: [], userName: 'Petr' },
  });
  apiFetch.mockResolvedValue({ ok: true, data: { data: [] } });
});

describe('průvodce importem kontroluje oprávnění na vstupu', () => {
  it('prohlížející dostane vysvětlení, ne průvodce', async () => {
    getWorkspaceAccess.mockResolvedValue({
      ok: true,
      data: { workspace: WORKSPACE, role: 'viewer', permissions: [], userName: 'Petr' },
    });

    const types = typesIn(await renderPage());

    expect(types).toContain(ForbiddenSection);
    expect(types).not.toContain(ImportWizard);
    // Odmítnutí se VYSVĚTLÍ, nezamlčí: 404 by tvrdila, že obrazovka neexistuje.
    expect(notFound).not.toHaveBeenCalled();
    // Seznamy se pro prohlížejícího ani nenačítají.
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('editor projde do průvodce', async () => {
    const types = typesIn(await renderPage());

    expect(types).toContain(ImportWizard);
    expect(types).not.toContain(ForbiddenSection);
  });
});
