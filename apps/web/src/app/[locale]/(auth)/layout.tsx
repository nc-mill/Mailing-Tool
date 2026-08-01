import type { ReactNode } from 'react';

/**
 * Obrazovky mimo skořápku aplikace. Vědomě tu není topbar, sidebar ani
 * přepínač projektů: uživatel v tuhle chvíli žádný projekt nemá.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4 py-10">
      <main className="w-full max-w-md">{children}</main>
    </div>
  );
}
