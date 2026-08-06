import { Suspense, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Mail } from '@mlain/ui/icons';
import { AccountBackLink } from '@/features/shell/account-back-link';
import { getCurrentUser } from '@/lib/identity/current-user';

/**
 * Přihlášený uživatel mimo projekt: profil a stav „nemám projekt". Skořápku
 * projektu tu nevykreslujeme, protože profil je nadprojektový a
 * `/no-workspace` z definice žádný projekt nemá. Boční menu projektu by tady
 * lhalo: nabízelo by kontakty a kampaně jednoho projektu na obrazovce, která
 * platí pro všechny.
 *
 * HLAVIČKA ALE ZŮSTÁVÁ. Bez ní byla obrazovka slepá ulice: značka nahoře
 * chyběla, cesta zpět taky, a kdo si `/settings/profile` otevřel z adresního
 * řádku, neměl z ní jak odejít. Je to zúžená podoba hlavičky projektu, tedy
 * značka vlevo a jediné tlačítko vpravo, ne kopie `Topbar` s přepínačem
 * projektů a hledáním, které by odsud stejně neměly kam vést.
 *
 * Uživatele čte layout sám, kvůli seznamu projektů pro cestu zpět. Stojí to
 * jeden dotaz na požadavek: `getCurrentUser` je cachovaný Reactem, takže
 * stránka pod layoutem sáhne po téže odpovědi. Chybu tady NEŘEŠÍME, jen se
 * neukáže cesta zpět; přihlášení i hlášky vlastní stránka, která ví, kam se
 * má uživatel po přihlášení vrátit.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  const me = await getCurrentUser();
  const targets = me.ok
    ? me.data.memberships.map((membership) => ({
        slug: membership.slug,
        label: t('shell.backToProject', { name: membership.name }),
      }))
    : [];

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-[var(--z-topbar)] flex min-h-[var(--size-topbar)] items-center gap-[var(--spacing-card)] border-b border-border bg-surface px-[var(--spacing-card)]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-3 focus:py-2"
        >
          {t('shell.skipToContent')}
        </a>

        <span className="flex items-center gap-[var(--spacing-inline)]">
          <span
            aria-hidden
            className="inline-flex size-[var(--size-mark)] items-center justify-center rounded-[var(--radius-control)] bg-primary text-primary-foreground"
          >
            <Mail className="icon-md" />
          </span>
          <span className="text-h3 font-semibold tracking-[var(--tracking-heading)] whitespace-nowrap text-text">
            Mlain Mailer
          </span>
        </span>

        {/* Bez členství není kam se vracet, tak se tlačítko nenabízí: na
            `/no-workspace` se dostane jen ten, kdo žádný projekt nemá.
            `Suspense` je tu kvůli `useSearchParams` uvnitř odkazu. */}
        {targets.length > 0 ? (
          <div className="ml-auto">
            <Suspense fallback={null}>
              <AccountBackLink targets={targets} />
            </Suspense>
          </div>
        ) : null}
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
