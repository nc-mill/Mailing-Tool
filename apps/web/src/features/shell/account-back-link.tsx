'use client';

import { useSearchParams } from 'next/navigation';
import { Link } from '@mlain/i18n/navigation';
import { ArrowLeft } from '@mlain/ui/icons';

export type AccountBackTarget = {
  slug: string;
  /** Hotový popisek („Zpět do projektu E-shop Kolo"), ne šablona: funkci ze
      serverové komponenty do klientské předat nejde. */
  label: string;
};

/**
 * Cesta zpět do projektu z osobních obrazovek (`/settings/profile`).
 *
 * PROČ EXISTUJE: profil je nadprojektový, takže bydlí mimo skořápku projektu
 * a nemá ani hlavičku, ani boční menu. Z obrazovky se pak nedalo odejít jinak
 * než tlačítkem zpět v prohlížeči, a kdo si adresu otevřel rovnou z adresního
 * řádku, neměl ani to.
 *
 * KTERÝ PROJEKT: nabídka uživatele posílá do adresy `?from=<slug>`, takže se
 * vrací tam, odkud uživatel přišel. Slug se porovnává se seznamem členství
 * ze serveru, takže odkaz nikdy nemíří jinam než do projektu, kterého je
 * uživatel členem; cizí hodnota v adrese se ignoruje. Bez parametru se
 * nabídne první projekt, aby cesta ven existovala i po otevření adresy
 * načisto, kdy žádná historie není.
 *
 * Je to klientská komponenta, protože `?from` je dostupné jen přes
 * `useSearchParams`. Layout parametry adresy nedostává.
 */
export function AccountBackLink({ targets }: { targets: AccountBackTarget[] }) {
  const from = useSearchParams().get('from');
  const target = targets.find((entry) => entry.slug === from) ?? targets[0];
  if (!target) return null;

  return (
    <Link
      href={`/w/${target.slug}`}
      // Podtržení kreslí globální styl na `<a>`, takže `no-underline` musí
      // sedět přímo tady. Vzhled se řídí tlačítkem hledání v hlavičce projektu,
      // aby hlavička účtu nevypadala jako z jiné aplikace.
      className="inline-flex min-h-[var(--size-control)] items-center gap-[var(--spacing-inline)] rounded-[var(--radius-control)] border border-border px-3.5 text-ui text-text no-underline hover:bg-surface-muted"
    >
      <ArrowLeft aria-hidden className="icon-sm" />
      {target.label}
    </Link>
  );
}
