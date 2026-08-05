'use client';

import { HelpCircle, Search } from 'lucide-react';
import { Button } from '../../components/button';

/**
 * Topbar. Nápověda je na všech stránkách na stejném místě
 * (WCAG 2.2, kritérium 3.2.6 Consistent Help), včetně průvodců.
 *
 * `onOpenSearch` a `onOpenHelp` jsou NEPOVINNÉ a bez nich se tlačítko
 * nevykreslí. Dřív byly povinné, takže skořápka do nich dosadila prázdnou
 * funkci a v hlavičce svítilo hledání i nápověda, které po kliknutí neudělaly
 * nic. Tlačítko, které nic nedělá, je horší než chybějící tlačítko: slibuje
 * funkci, kterou produkt nemá, a uživatel ji zkouší znovu. Kritérium 3.2.6
 * mluví o tom, že nápověda má být na stejném místě všude, ne o tom, že tam má
 * být atrapa. Jakmile paleta příkazů a nápověda budou mít obsah, předá je
 * skořápka sem a tlačítka se vrátí na svoje původní místo.
 */
export function Topbar({
  workspaceSwitcher,
  onOpenSearch,
  onOpenHelp,
  jobsBadge,
  userMenu,
  labels,
}: {
  workspaceSwitcher: React.ReactNode;
  onOpenSearch?: (() => void) | undefined;
  onOpenHelp?: (() => void) | undefined;
  jobsBadge: React.ReactNode;
  userMenu: React.ReactNode;
  labels: { search: string; help: string; skipToContent: string };
}) {
  return (
    <header className="flex h-[var(--size-topbar)] items-center gap-3 border-b border-border bg-surface px-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-3 focus:py-2"
      >
        {labels.skipToContent}
      </a>

      <span className="font-semibold text-text">Mlain Mailer</span>
      {workspaceSwitcher}

      <div className="flex-1" />

      {onOpenSearch ? (
        <Button variant="ghost" onClick={onOpenSearch}>
          <Search aria-hidden className="size-4" />
          {labels.search}
        </Button>
      ) : null}
      {onOpenHelp ? (
        <Button variant="ghost" onClick={onOpenHelp} aria-label={labels.help}>
          <HelpCircle aria-hidden className="size-4" />
        </Button>
      ) : null}
      {jobsBadge}
      {userMenu}
    </header>
  );
}
