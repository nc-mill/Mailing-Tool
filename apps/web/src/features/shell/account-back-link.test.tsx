// Matchery jest-dom se typují modulovou augmentací, viz komentář v setup-form.test.tsx.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountBackLink } from './account-back-link';

let search = new URLSearchParams();

vi.mock('next/navigation', () => ({ useSearchParams: () => search }));

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

const TARGETS = [
  { slug: 'eshop-kolo', label: 'Zpět do projektu E-shop Kolo' },
  { slug: 'newsletter', label: 'Zpět do projektu Newsletter redakce' },
];

describe('cesta zpět z osobních obrazovek', () => {
  it('vede do projektu, ze kterého uživatel přišel', () => {
    search = new URLSearchParams('from=newsletter');
    render(<AccountBackLink targets={TARGETS} />);

    expect(
      screen.getByRole('link', { name: 'Zpět do projektu Newsletter redakce' }),
    ).toHaveAttribute('href', '/w/newsletter');
  });

  it('bez parametru nabídne první projekt, aby cesta ven existovala i bez historie', () => {
    // Adresa otevřená načisto z adresního řádku. Přesně tenhle případ dělal
    // z profilu slepou ulici: hlavička žádná, historie žádná.
    search = new URLSearchParams();
    render(<AccountBackLink targets={TARGETS} />);

    expect(screen.getByRole('link', { name: 'Zpět do projektu E-shop Kolo' })).toHaveAttribute(
      'href',
      '/w/eshop-kolo',
    );
  });

  it('cizí slug v adrese odkaz nepřesměruje', () => {
    // `from` je vstup z adresního řádku, takže se porovnává se seznamem
    // členství ze serveru. Jinak by šlo odkaz namířit kamkoli.
    search = new URLSearchParams('from=cizi-projekt');
    render(<AccountBackLink targets={TARGETS} />);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/w/eshop-kolo');
  });

  it('bez jediného projektu se odkaz nevykreslí', () => {
    // Stav `/no-workspace`: vracet se není kam a odkaz na `/w/undefined`
    // by byl mrtvé tlačítko.
    search = new URLSearchParams();
    const { container } = render(<AccountBackLink targets={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
