import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './sidebar';
import type { VisibleNavigationItem } from '../navigation/visible-navigation';

const ITEMS: VisibleNavigationItem[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    path: '',
    permission: null,
    href: '/w/eshop-kolo',
  } as unknown as VisibleNavigationItem,
  {
    id: 'contacts',
    labelKey: 'nav.contacts',
    path: 'contacts',
    permission: null,
    href: '/w/eshop-kolo/contacts',
    children: [
      {
        id: 'contacts-all',
        labelKey: 'nav.contactsAll',
        path: 'contacts',
        permission: null,
        href: '/w/eshop-kolo/contacts',
      },
      {
        id: 'contacts-lists',
        labelKey: 'nav.lists',
        path: 'lists',
        permission: null,
        href: '/w/eshop-kolo/lists',
      },
    ],
  } as unknown as VisibleNavigationItem,
];

const LABELS = {
  mainNavigation: 'Hlavní navigace',
  collapse: 'Sbalit menu',
  expand: 'Rozbalit menu',
  toggleSection: (section: string) => `Rozbalit nebo sbalit podpoložky: ${section}`,
};

const TRANSLATIONS: Record<string, string> = {
  'nav.overview': 'Přehled',
  'nav.contacts': 'Kontakty',
  'nav.contactsAll': 'Všechny kontakty',
  'nav.lists': 'Seznamy',
};

function renderSidebar(props: { collapsed?: boolean; currentPath?: string } = {}) {
  return render(
    <Sidebar
      items={ITEMS}
      currentPath={props.currentPath ?? '/w/eshop-kolo/contacts'}
      collapsed={props.collapsed ?? false}
      counts={{ contacts: 58 }}
      onToggleCollapse={vi.fn()}
      translate={(key) => TRANSLATIONS[key] ?? key}
      renderLink={({ href, label, active, children }) => (
        <a href={href} aria-label={label} aria-current={active ? 'page' : undefined}>
          {children}
        </a>
      )}
      labels={LABELS}
    />,
  );
}

/** Řádek položky: obal, který nese označení, odkaz i šipku podpoložek. */
function row(label: string): HTMLElement {
  const link = screen.getByRole('link', { name: label });
  const element = link.parentElement;
  if (element === null) throw new Error(`řádek položky ${label} nemá obal`);
  return element;
}

describe('Sidebar', () => {
  it('odkaz vyplní celý řádek, aby označení sekce došlo k okraji menu', () => {
    renderSidebar();
    // Regrese z 5. 8. 2026: odkaz byl jako flexový prvek jen tak široký, jak
    // dlouhý byl jeho text, takže žlutý proužek a plocha aktivní sekce končily
    // v půlce menu. Šířku v jsdom změřit nejde, drží ji tenhle selektor.
    expect(row('Kontakty').className).toContain('[&>a]:flex-1');
  });

  it('označení aktivní sekce nese řádek, ne text uvnitř', () => {
    renderSidebar();
    const active = row('Kontakty');
    expect(active.className).toContain('border-l-primary');
    expect(active.className).toContain('bg-panel-line');
    // Neaktivní sekce má proužek průhledný, ne žádný: jinak by se položky
    // při přejetí posunuly o tři pixely.
    expect(row('Přehled').className).toContain('border-l-transparent');
  });

  it('šipka podpoložek je uvnitř řádku a rozbaluje jen podpoložky', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', {
      name: 'Rozbalit nebo sbalit podpoložky: Kontakty',
    });
    expect(row('Kontakty')).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Seznamy' })).toBeNull();
    // Odkaz na sekci zůstal odkazem, šipka ho nepřebila.
    expect(screen.getByRole('link', { name: 'Kontakty' })).toHaveAttribute(
      'href',
      '/w/eshop-kolo/contacts',
    );
  });

  it('počet u položky se vypisuje mono a jen tam, kde je', () => {
    renderSidebar();
    expect(within(row('Kontakty')).getByText('58')).toBeVisible();
    expect(within(row('Přehled')).queryByText('58')).toBeNull();
  });

  it('zabalené menu ukazuje podpoložky ve vysouvacím panelu a Escape ho zavře', async () => {
    const user = userEvent.setup();
    renderSidebar({ collapsed: true });
    // Zabalené menu nemá ani popisky, ani šipku, ani podpoložky pod položkou.
    expect(screen.queryByRole('button', { name: /podpoložky/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Seznamy' })).toBeNull();

    await user.hover(screen.getByRole('link', { name: 'Kontakty' }));
    expect(await screen.findByRole('link', { name: 'Seznamy' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Seznamy' })).toBeNull();
  });

  it('vysouvací panel otevře i fokus, aby se k podpoložkám dalo z klávesnice', async () => {
    const user = userEvent.setup();
    renderSidebar({ collapsed: true });
    await user.tab();
    await user.tab();
    expect(await screen.findByRole('link', { name: 'Seznamy' })).toBeVisible();
  });
});
