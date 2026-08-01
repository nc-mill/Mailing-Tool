'use client';

import { HelpCircle, Search } from 'lucide-react';
import { Button } from '../../components/button';

/**
 * Topbar. Nápověda je na všech stránkách na stejném místě
 * (WCAG 2.2, kritérium 3.2.6 Consistent Help), včetně průvodců.
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
  onOpenSearch: () => void;
  onOpenHelp: () => void;
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

      <Button variant="ghost" onClick={onOpenSearch}>
        <Search aria-hidden className="size-4" />
        {labels.search}
      </Button>
      <Button variant="ghost" onClick={onOpenHelp} aria-label={labels.help}>
        <HelpCircle aria-hidden className="size-4" />
      </Button>
      {jobsBadge}
      {userMenu}
    </header>
  );
}
