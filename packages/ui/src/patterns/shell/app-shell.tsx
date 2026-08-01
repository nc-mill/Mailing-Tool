'use client';

import { cn } from '../../lib/cn';
import { SystemBar, type SystemBarState } from './system-bar';

/** Kostra stránky: topbar nahoře, sidebar vlevo, obsah, systémový pruh dole. */
export function AppShell({
  topbar,
  sidebar,
  systemBarStates,
  children,
  className,
}: {
  topbar: React.ReactNode;
  sidebar: React.ReactNode;
  systemBarStates: SystemBarState[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-dvh flex-col bg-surface', className)}>
      {topbar}
      <div className="flex flex-1 overflow-hidden">
        {sidebar}
        {/* Odsazení dole nechává místo systémovému pruhu, aby nezakryl
            fokusovaný prvek (WCAG 2.2, kritérium 2.4.11). */}
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-[var(--spacing-gutter)] pb-20"
        >
          {children}
        </main>
      </div>
      <SystemBar states={systemBarStates} />
    </div>
  );
}
