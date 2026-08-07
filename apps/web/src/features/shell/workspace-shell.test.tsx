// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
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

  /**
   * Regrese na vodorovné přetečení na úzkém displeji.
   *
   * Rozbalené boční menu si bere 236 px. Na displeji 390 px zbylo hlavnímu
   * sloupci 139 px, do kterých se nevešel ani nadpis stránky, takže stránka
   * přetékala doprava (naměřeno 7. 8. 2026: `scrollWidth` 558 px na Kontaktech
   * a 636 px na Nastavení proti `clientWidth` 375 px). Šířku menu jsdom
   * nespočítá, měří se proto ROZHODNUTÍ: pod 1024 px se menu zabalí na ikony.
   */
  it('pod 1024 px se boční menu zabalí samo a tlačítko zabalení zmizí', () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 1023px)',
      media: query,
      addEventListener: (_: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
    }));

    renderShell();

    // Zabalené menu ukazuje jen ikony, popisek sekce se nevykresluje.
    expect(screen.queryByText('Kontakty')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kontakty' })).toBeInTheDocument();
    // Menu je zabalené z donucení, takže tlačítko zabalení nemá co dělat.
    expect(screen.queryByRole('button', { name: 'Sbalit menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rozbalit menu' })).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /**
   * Regrese na skořápku úzkého displeje.
   *
   * Zabalené menu si pořád bere 76 px z 375, tedy pětinu telefonu, a hlavnímu
   * sloupci zbývalo 269 px obsahu: tlačítka pruhu akcí končila za pravým
   * okrajem a stránka se posouvala do strany (naměřeno 7. 8. 2026 na Přehledu,
   * Kontaktech i v detailu kontaktu). Pod 768 px proto menu v rozvržení
   * NENÍ VŮBEC a otevírá se tlačítkem.
   *
   * Šířku ani `display` jsdom nespočítá, měří se tedy ROZHODNUTÍ: obal menu
   * nese `hidden md:block` a v hlavičce stojí tlačítko, které otevře panel
   * s celou navigací. Že se stránka opravdu přestala posouvat, je změřené
   * v prohlížeči a zapsané v `HOTOVO.md`.
   */
  it('pod 768 px menu v rozvržení není a otevírá se tlačítkem v hlavičce', async () => {
    const user = userEvent.setup();
    renderShell();

    const layoutNavigation = screen.getByRole('navigation', { name: 'Hlavní navigace' });
    expect(layoutNavigation.parentElement).toHaveClass('hidden', 'md:block');

    const toggle = screen.getByRole('button', { name: 'Otevřít hlavní menu' });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(toggle);

    // V panelu je menu ROZBALENÉ, s popisky: panel má plnou šířku menu
    // a na dotykovém displeji není kam najet myší pro bublinu s názvem.
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('link', { name: 'Kontakty' })).toBeVisible();
    expect(within(panel).getByText('Kampaně')).toBeVisible();
    // Tlačítko zabalení do panelu nepatří, zabalit ho není kam.
    expect(within(panel).queryByRole('button', { name: 'Sbalit menu' })).not.toBeInTheDocument();
  });

  it('kliknutí na položku vysouvacího menu panel zavře, jinak by zakryl cílovou stránku', async () => {
    const user = userEvent.setup();
    const { rerender } = renderShell();

    await user.click(screen.getByRole('button', { name: 'Otevřít hlavní menu' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Přechod na jinou stránku. Panel se řídí cestou, ne obsluhou kliknutí:
    // cesta se změní i po tlačítku Zpět a po přesměrování ze serverové akce.
    pathname = '/w/eshop-kolo/campaigns';
    rerender(
      <NextIntlClientProvider locale="cs" messages={{ common: csCommon }} timeZone="Europe/Prague">
        <WorkspaceShell
          workspaces={WORKSPACES}
          currentWorkspaceId={WORKSPACES[0]!.id}
          permissions={ROLE_PERMISSIONS.owner}
          user={{ name: 'Petr Novák', email: 'petr@example.com' }}
          greetingEnabled
          createWorkspace={vi.fn()}
        >
          <p>Obsah stránky</p>
        </WorkspaceShell>
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    pathname = '/w/eshop-kolo';
  });

  it('nad 1024 px zůstane menu rozbalené a jde ho zabalit ručně', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    renderShell();

    expect(screen.getByText('Kontakty')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sbalit menu' })).toBeVisible();

    vi.unstubAllGlobals();
  });
});
