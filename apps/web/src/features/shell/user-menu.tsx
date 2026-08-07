'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { logoutAction } from '@/features/profile/actions';

export type UserMenuProps = {
  user: { name: string; email: string };
  /** Projekt, ze kterého se na profil odchází. Nese ho adresa, aby se z profilu
      bylo kam vrátit. */
  workspaceSlug: string;
};

/**
 * Nabídka přihlášeného uživatele v hlavičce.
 *
 * PROČ VZNIKLA: skořápka posílala `userMenu={null}`, takže se z aplikace
 * NEDALO ODHLÁSIT. Jediné tlačítko „Odhlásit se" bydlelo na obrazovce
 * `/no-workspace`, kam se člen jakéhokoliv projektu nedostane, protože ho
 * odtud přesměruje na první projekt. Odhlášení tedy vyžadovalo smazat cookie
 * v nástrojích prohlížeče.
 *
 * Odhlášení jde přes SKRYTÝ FORMULÁŘ, ne přes volání serverové akce z
 * obsluhy kliknutí. Položka nabídky je Radix `Item`, tedy `div` s rolí
 * `menuitem`, do kterého se odesílací tlačítko vložit nedá, aniž by kliknutí
 * spustilo obojí. `requestSubmit()` na formuláři vedle nabídky dělá přesně
 * totéž co odhlášení na `/no-workspace`, včetně přesměrování na přihlášení.
 *
 * Profil je OSOBNÍ, ne projektový, a leží mimo skořápku projektu na
 * `/settings/profile`. Nabídka vede rovnou tam.
 *
 * OD 6. 8. 2026 je to JEDINÁ cesta do Můj účet: položka „Nastavení > Můj účet"
 * z registru navigace odešla, protože přístup ze dvou míst mátl a účet do
 * nastavení projektu nepatří. Když tuhle nabídku někdo rozbije nebo schová,
 * uživatel se ke svému profilu nedostane odnikud.
 *
 * Adresa nese `?from=<slug>`, protože profil je mimo skořápku a sám nepozná,
 * ze kterého projektu se na něj přišlo. Bez toho by cesta zpět mířila u
 * uživatele s víc projekty do jiného, než ze kterého odešel.
 */
export function UserMenu({ user, workspaceSlug }: UserMenuProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const logoutRef = useRef<HTMLFormElement>(null);

  // Jméno nemusí být vyplněné, e-mail ano. Prázdný spouštěč by byl tlačítko
  // bez přístupného jména, které hlasové ovládání nenajde.
  const label = user.name === '' ? user.email : user.name;

  /**
   * Iniciály do čtverečku. Ze jména první písmena prvních dvou slov,
   * z e-mailu první písmeno. `Array.from` a ne `[0]`, protože znak
   * s háčkem může být v UTF-16 dvě jednotky a `Č` by se rozpadlo.
   */
  const initials = label
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('shell.userMenu')}
          className="flex min-h-11 items-center gap-[var(--spacing-inline)] rounded-[var(--radius-control)] border-l border-border pl-[var(--spacing-stack)] text-ui text-text"
        >
          {/* Iniciály v žlutém čtverci, jako v návrhu. Jsou `aria-hidden`,
              protože hned vedle stojí celé jméno: čtečka by jinak přečetla
              „PN Petr Novák". */}
          <span
            aria-hidden
            className="inline-flex size-[var(--size-avatar)] items-center justify-center rounded-[var(--radius-control)] bg-accent-surface font-mono text-meta text-warning-text"
          >
            {initials}
          </span>
          {/* JMÉNO SE POD 640 px SKRÝVÁ, iniciály zůstávají. Vejde se do něj
              160 px, tedy skoro polovina šířky telefonu, za údaj, který
              uživatel o sobě ví. Tlačítko o přístupné jméno nepřijde, nese ho
              `aria-label` výš. */}
          <span className="hidden max-w-40 truncate sm:inline">{label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Kdo je přihlášený, se pozná z e-mailu, ne ze jména: dva lidé se
              stejným jménem v jednom projektu jsou běžná věc. Není to položka
              nabídky, nedá se na to kliknout ani zaostřit. */}
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-text">{label}</p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              router.push(`/settings/profile?from=${encodeURIComponent(workspaceSlug)}`)
            }
          >
            {t('shell.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => logoutRef.current?.requestSubmit()}>
            {t('shell.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={logoutRef} action={logoutAction} className="hidden" />
    </>
  );
}
