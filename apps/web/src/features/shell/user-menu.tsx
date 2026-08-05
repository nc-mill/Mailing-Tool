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
 * `/settings/profile`. Uvnitř projektu na něj míří `/settings/account`, což je
 * jen přesměrování; nabídka proto vede rovnou na cíl.
 */
export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations('common');
  const router = useRouter();
  const logoutRef = useRef<HTMLFormElement>(null);

  // Jméno nemusí být vyplněné, e-mail ano. Prázdný spouštěč by byl tlačítko
  // bez přístupného jména, které hlasové ovládání nenajde.
  const label = user.name === '' ? user.email : user.name;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('shell.userMenu')}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-text hover:bg-surface-muted"
        >
          {/* Ikony jsou v tomhle produktu doma v designovém systému, ne
              v aplikaci: `lucide-react` je závislost balíčku `@mlain/ui`
              a apps/web ji nemá. Jméno v hlavičce si vystačí s textem. */}
          <span className="max-w-40 truncate">{label}</span>
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
          <DropdownMenuItem onSelect={() => router.push('/settings/profile')}>
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
