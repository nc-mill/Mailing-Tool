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
    // Slug otevřeného projektu jde s sebou v adrese: profil leží mimo skořápku
    // a sám by nepoznal, kam vede cesta zpět.
    expect(push).toHaveBeenCalledWith('/settings/profile?from=eshop-kolo');
  });

  it('menu se řídí skutečnými oprávněními, ne natvrdo psaným seznamem', () => {
    /*
     * Test dřív sahal na podpoložky Nastavení („Odesílání", „Zálohy", …), které
     * skořápka pod zástupným seznamem oprávnění odfiltrovala. Boční menu je od
     * 6. 8. 2026 nevykresluje, protože je zdvojovala stránková navigace uvnitř
     * Nastavení, takže se totéž tvrdí na sekcích PRVNÍ úrovně. Že podpoložky
     * dostane ten, kdo na ně má oprávnění, hlídá `settings-nav.test.tsx`
     * a `visible-navigation.test.ts`.
     *
     * Sekce se schválně berou i takové, které chtějí něco jiného než tu
     * nejběžnější trojici: Knihovna médií `assets:read`, Statistiky
     * `reports:read`. Zástupný seznam měl přesně tenhle tvar, tedy pár
     * oprávnění navíc chybělo a v menu tiše ubylo.
     */
    const { unmount } = renderShell();
    for (const label of [
      'Přehled',
      'Kontakty',
      'Formuláře',
      'Kampaně',
      'Šablony',
      'Knihovna médií',
      'Statistiky',
      'Nastavení',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeVisible();
    }
    unmount();

    // Prohlížející je nesmí dostat jen proto, že se opravila skořápka.
    renderShell(ROLE_PERMISSIONS.viewer);
    // Celá sekce Nastavení je prohlížejícímu pryč od 6. 8. 2026, kdy z ní
    // odešel „Můj účet": na žádnou zbylou podpoložku nemá oprávnění.
    expect(screen.queryByRole('link', { name: 'Nastavení' })).not.toBeInTheDocument();
    // Kontrola, že menu nezmizelo celé. Bez ní by řádky výš prošly i tehdy,
    // kdyby se filtrování rozbilo a prohlížející neviděl vůbec nic.
    expect(screen.getByRole('link', { name: 'Kontakty' })).toBeVisible();
  });

  /**
   * NASTAVENÍ SE V BOČNÍM MENU NEROZBALUJE, rozhodnutí zadavatele ze 6. 8. 2026.
   *
   * Stejné položky stály dvakrát vedle sebe: jednou v bočním menu, podruhé ve
   * stránkové navigaci uvnitř každé obrazovky Nastavení. Zůstala ta stránková.
   *
   * Cesta je podstránka Nastavení, aby sekce byla otevřená. Kdyby se test
   * postavil na Přehledu, prošel by i s vráceným submenu, protože zavřená sekce
   * podpoložky nevykresluje tak jako tak.
   */
  it('Nastavení je v bočním menu obyčejný odkaz, podpoložky duplikuje stránková navigace', () => {
    pathname = '/w/eshop-kolo/settings/general';
    renderShell();

    expect(screen.getByRole('link', { name: 'Nastavení' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Rozbalit nebo sbalit podpoložky: Nastavení' }),
    ).not.toBeInTheDocument();
    for (const label of ['Projekt', 'Značka projektu', 'Odesílání', 'Zálohy', 'Audit log']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }

    // Kontakty se rozbalují dál, pravidlo se týká jen Nastavení.
    pathname = '/w/eshop-kolo/contacts';
    renderShell();
    expect(screen.getByRole('link', { name: 'Seznamy' })).toBeVisible();

    pathname = '/w/eshop-kolo';
  });

  it('hledání a nápověda se nenabízejí, dokud za nimi nic není', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Hledat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nápověda' })).not.toBeInTheDocument();
  });
});
