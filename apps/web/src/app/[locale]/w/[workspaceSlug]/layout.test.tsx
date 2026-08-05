import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ROLE_PERMISSIONS } from '@mlain/core/identity/permissions';
import type { Role } from '@mlain/core/identity/types';

/**
 * Brána nad tím, že skořápka projektu předává SKUTEČNÁ data.
 *
 * Přesně tahle vada přežila půl roku: skořápka si seznam projektů, oprávnění
 * i název projektu držela sama jako zástupné hodnoty, a testovala se jen
 * komponenta s ručně dodanými props. Komponenta o zástupném seznamu nic neví,
 * takže byla zeleně a přepínač projektů přitom nabízel jediný projekt, ten
 * otevřený. Tenhle test proto NEVOLÁ komponentu, ale serverovou část skořápky,
 * a dívá se, co z ní doopravdy vyleze.
 */

const requireUser = vi.fn();
const getWorkspaceAccess = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

/** Props, se kterými se klientská skořápka naposledy vykreslila. */
let shellProps: Record<string, unknown> | null = null;

vi.mock('@/lib/identity/require-user', () => ({
  requireUser: (path: string) => requireUser(path),
}));
vi.mock('@/lib/identity/workspace-access', () => ({
  getWorkspaceAccess: (slug: string) => getWorkspaceAccess(slug),
}));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('@/features/auth/actions', () => ({ createWorkspaceAction: vi.fn() }));
vi.mock('@/features/auth/action-problem', () => ({
  AuthProblem: () => null,
}));
vi.mock('@/features/shell/workspace-shell', () => ({
  WorkspaceShell: (props: Record<string, unknown>) => {
    shellProps = props;
    return null;
  },
}));

const { default: WorkspaceLayout } = await import('./layout');

type Membership = { workspace_id: string; name: string; slug: string; role: Role };

const OWNER_MEMBERSHIP: Membership = {
  workspace_id: '018f2b1c-0000-7000-8000-000000000001',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
  role: 'owner',
};

const VIEWER_MEMBERSHIP: Membership = {
  workspace_id: '018f2b1c-0000-7000-8000-000000000002',
  name: 'Newsletter redakce',
  slug: 'newsletter',
  role: 'viewer',
};

const USER = {
  id: '018f2b1c-0000-7000-8000-0000000000ff',
  email: 'petr@example.com',
  name: 'Petr Novák',
  locale: 'cs',
  timezone: 'Europe/Prague',
};

function workspaceOf(membership: Membership) {
  return {
    id: membership.workspace_id,
    name: membership.name,
    slug: membership.slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
    address_form: 'formal' as const,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

/** Vykreslí serverovou skořápku a vrátí props, které předala té klientské. */
async function renderShell(slug: string): Promise<Record<string, unknown>> {
  shellProps = null;
  const element = await WorkspaceLayout({
    children: null,
    params: Promise.resolve({ workspaceSlug: slug }),
  });
  // Serverová komponenta vrací element klientské skořápky. Zavoláním jeho typu
  // se props zapíšou do `shellProps`, aniž by se montoval celý strom.
  const node = element as { type: (props: Record<string, unknown>) => unknown; props: unknown };
  node.type(node.props as Record<string, unknown>);
  if (shellProps === null) throw new Error('Skořápka klientskou část vůbec nevykreslila.');
  return shellProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({
    ok: true,
    data: { user: USER, memberships: [OWNER_MEMBERSHIP, VIEWER_MEMBERSHIP], csrf_token: '' },
  });
  getWorkspaceAccess.mockImplementation((slug: string) => {
    const membership = [OWNER_MEMBERSHIP, VIEWER_MEMBERSHIP].find((entry) => entry.slug === slug);
    if (!membership) return Promise.resolve({ ok: false, problem: { status: 404 } });
    return Promise.resolve({
      ok: true,
      data: {
        workspace: workspaceOf(membership),
        role: membership.role,
        permissions: ROLE_PERMISSIONS[membership.role],
        userName: USER.name,
      },
    });
  });
});

describe('skořápka projektu bere data z vrstvy identity', () => {
  it('do přepínače jdou VŠECHNY projekty přihlášeného, ne jen ten otevřený', async () => {
    const props = await renderShell('eshop-kolo');

    // Dřív tady stálo `workspaces={[workspace]}`, takže se přepnout nedalo.
    expect(props['workspaces']).toEqual([
      { id: OWNER_MEMBERSHIP.workspace_id, slug: 'eshop-kolo', name: 'E-shop Kolo' },
      { id: VIEWER_MEMBERSHIP.workspace_id, slug: 'newsletter', name: 'Newsletter redakce' },
    ]);
  });

  it('projekt se pozná podle názvu a identifikátoru, ne podle slugu z adresy', async () => {
    const props = await renderShell('eshop-kolo');

    expect(props['currentWorkspaceId']).toBe(OWNER_MEMBERSHIP.workspace_id);
    const workspaces = props['workspaces'] as Array<{ id: string; name: string }>;
    expect(workspaces[0]?.name).toBe('E-shop Kolo');
    expect(workspaces[0]?.name).not.toBe('eshop-kolo');
  });

  it('oprávnění jsou skutečná oprávnění role, ne natvrdo psaný seznam', async () => {
    const props = await renderShell('eshop-kolo');

    expect(props['permissions']).toEqual(ROLE_PERMISSIONS.owner);
    // Čtyři oprávnění, která v zástupném seznamu chyběla. Bez nich se z menu
    // odfiltrovalo Odesílání, Předvolby odesílatele, Stav systémové pošty,
    // Umělá inteligence, Zálohy i Značka projektu, přestože obrazovky existují
    // a owner na ně právo má.
    for (const permission of [
      'providers:read',
      'ai:configure',
      'backups:read',
      'templates:write',
    ]) {
      expect(props['permissions']).toContain(permission);
    }
  });

  it('prohlížející nedostane víc, než na co má právo', async () => {
    const props = await renderShell('newsletter');

    expect(props['permissions']).toEqual(ROLE_PERMISSIONS.viewer);
    for (const permission of [
      'workspace:update',
      'members:invite',
      'api_keys:read',
      'audit:read',
    ]) {
      expect(props['permissions']).not.toContain(permission);
    }
  });

  it('skořápka zná přihlášeného, takže se z aplikace dá odhlásit', async () => {
    const props = await renderShell('eshop-kolo');

    expect(props['user']).toEqual({ name: 'Petr Novák', email: 'petr@example.com' });
    expect(typeof props['createWorkspace']).toBe('function');
  });

  it('když selže čtení projektu, skořápka se poskládá z členství a nezhasne', async () => {
    getWorkspaceAccess.mockResolvedValue({
      ok: false,
      problem: { status: 503, code: 'service_unavailable' },
    });

    const props = await renderShell('eshop-kolo');

    expect(props['currentWorkspaceId']).toBe(OWNER_MEMBERSHIP.workspace_id);
    expect(props['permissions']).toEqual(ROLE_PERMISSIONS.owner);
  });

  it('projekt, ve kterém aktér nemá členství, je 404, ne 403', async () => {
    await expect(renderShell('cizi-projekt')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
