// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@mlain/core/identity/permissions';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import { WorkspaceShell } from './workspace-shell';

const push = vi.fn();

/** Boční menu rozbaluje podpoložky jen u otevřené sekce, viz `Sidebar`. */
let pathname = '/w/eshop-kolo';

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

// Odhlášení sahá na `server-only` a na cookies, což v jsdom neexistuje.
// Skořápka z akce potřebuje jen referenci pro formulář.
vi.mock('@/features/profile/actions', () => ({ logoutAction: vi.fn() }));

const WORKSPACES = [
  { id: '018f2b1c-0000-7000-8000-000000000001', slug: 'eshop-kolo', name: 'E-shop Kolo' },
  { id: '018f2b1c-0000-7000-8000-000000000002', slug: 'newsletter', name: 'Newsletter redakce' },
];

function renderShell(
  permissions: readonly string[] = ROLE_PERMISSIONS.owner,
  greetingEnabled = true,
) {
  return render(
    <NextIntlClientProvider locale="cs" messages={{ common: csCommon }} timeZone="Europe/Prague">
      <WorkspaceShell
        workspaces={WORKSPACES}
        currentWorkspaceId={WORKSPACES[0]!.id}
        permissions={permissions}
        user={{ name: 'Petr Novák', email: 'petr@example.com' }}
        greetingEnabled={greetingEnabled}
        createWorkspace={vi.fn()}
      >
        <p>Obsah stránky</p>
      </WorkspaceShell>
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceShell', () => {
  it('v hlavičce svítí název projektu, ne slug z adresy', () => {
    renderShell();
    expect(screen.getByRole('button', { name: /E-shop Kolo/ })).toBeVisible();
  });

  it('přepínač nabízí i ostatní projekty a přepne se do nich', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Newsletter redakce' }));

    expect(push).toHaveBeenCalledWith('/w/newsletter');
  });

  it('založení dalšího projektu je v přepínači, protože tam ho uživatel hledá', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Nový projekt' }));

    expect(await screen.findByLabelText('Název projektu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Založit projekt' })).toBeVisible();
  });

  it('z aplikace se dá odhlásit a dojít na vlastní profil', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Můj účet' }));
    expect(screen.getByRole('menuitem', { name: 'Odhlásit se' })).toBeVisible();

    await user.click(screen.getByRole('menuitem', { name: 'Můj profil' }));
    expect(push).toHaveBeenCalledWith('/settings/profile');
  });

  it('menu se řídí skutečnými oprávněními, ne natvrdo psaným seznamem', () => {
    // Sekce Nastavení musí být otevřená, jinak se podpoložky nevykreslí.
    pathname = '/w/eshop-kolo/settings/general';

    // Owner: šest položek, které se pod zástupným seznamem oprávnění
    // z menu odfiltrovaly, přestože obrazovky existují.
    const { unmount } = renderShell();
    for (const label of [
      'Značka projektu',
      'Odesílání',
      'Odesílatelé',
      'Systémová pošta',
      'AI asistent',
      'Zálohy',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeVisible();
    }
    unmount();

    // Prohlížející je nesmí dostat jen proto, že se opravila skořápka.
    renderShell(ROLE_PERMISSIONS.viewer);
    for (const label of ['Odesílání', 'Zálohy', 'Klíče k API', 'Členové']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Můj účet' })).toBeVisible();

    pathname = '/w/eshop-kolo';
  });

  it('hledání a nápověda se nenabízejí, dokud za nimi nic není', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Hledat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nápověda' })).not.toBeInTheDocument();
  });
});
