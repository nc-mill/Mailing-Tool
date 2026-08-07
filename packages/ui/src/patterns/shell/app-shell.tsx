'use client';

import { cn } from '../../lib/cn';
import { SystemBar, type SystemBarState } from './system-bar';

/**
 * Kostra stránky: hlavička nahoře, boční menu vlevo, obsah, systémový pruh dole.
 *
 * SKROLUJE CELÁ STRÁNKA, ne obsah uvnitř rámu. Hlavička i boční menu jsou
 * `sticky`, takže zůstanou na místě, ale prohlížeč pořád skroluje dokument.
 * Dřív měl obsah vlastní `overflow-y: auto` a mělo to dva následky, kterých
 * si všimne každý: kolečko myši nad menu nescrollovalo stránku a odkaz na
 * kotvu uvnitř stránky skočil jinam, protože `scroll-padding-top` platí pro
 * dokument, ne pro vnitřní rám.
 *
 * ŠÍŘKA OBSAHU se řídí `wide`. Běžná obrazovka má strop 1320 px, obrazovka
 * s širokou tabulkou 1560 px. Bez stropu by se text na širokém monitoru
 * roztáhl na řádky, které se špatně čtou.
 */
export function AppShell({
  topbar,
  sidebar,
  systemBarStates,
  wide = false,
  children,
  className,
}: {
  topbar: React.ReactNode;
  sidebar: React.ReactNode;
  systemBarStates: SystemBarState[];
  /** Široký obsah, například tabulka kontaktů s deseti sloupci. */
  wide?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-h-dvh bg-surface', className)}>
      {topbar}
      <div className="flex items-start">
        {sidebar}
        {/* Odsazení dole nechává místo systémovému pruhu, aby nezakryl
            fokusovaný prvek (WCAG 2.2, kritérium 2.4.11). */}
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'min-w-0 flex-1 pb-20',
            // VNITŘNÍ OKRAJ SE NA ÚZKÉM DISPLEJI STAHUJE. Pevných 40 px na
            // obou stranách je 80 px z 375 px, tedy pětina šířky na prázdno,
            // a hlavnímu sloupci zbývalo vedle bočního menu 139 px, do kterých
            // se nevešel ani nadpis stránky. Naměřeno 7. 8. 2026 na Kontaktech
            // i na Nastavení, tedy na obrazovce bez tabulky.
            'p-[var(--spacing-stack)] sm:p-[var(--spacing-page)]',
            wide ? 'max-w-[var(--container-screen-wide)]' : 'max-w-[var(--container-screen)]',
          )}
        >
          {children}
        </main>
      </div>
      <SystemBar states={systemBarStates} />
    </div>
  );
}
