import type { ReactNode } from 'react';

/**
 * Přihlášený uživatel mimo projekt: profil a stav „nemám projekt". Skořápku
 * s přepínačem projektů tu nevykreslujeme, protože profil je nadprojektový
 * a `/no-workspace` z definice žádný projekt nemá.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <main>{children}</main>
    </div>
  );
}
