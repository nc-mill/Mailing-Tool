'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card } from '@mlain/ui/components/card';
import { visibleNavigation } from '@mlain/ui/patterns/navigation';
import { cn } from '@mlain/ui/lib/cn';

export type SettingsNavProps = {
  workspaceSlug: string;
  /** Oprávnění aktéra, spočítaná na serveru. Klient matici nezná. */
  permissions: readonly string[];
};

/**
 * Sekce, na kterou uživatel nemá oprávnění, se v navigaci nezobrazuje
 * (5.2 části 1 a pravidlo 1 v 7.2b části 6).
 *
 * Filtrování si tenhle soubor **nepíše sám**. `visibleNavigation` z P05
 * odfiltruje položky bez oprávnění, zahodí rezervované i ty s `mvp0: false`,
 * dopočítá `href` se slugem a zahodí sekci, které nezbyla ani jedna viditelná
 * podpoložka. Právě to poslední pravidlo se při druhém psaní zapomíná, a dvě
 * pravidla pro totéž se dřív nebo později rozejdou.
 *
 * Oprávnění u položek jsou ta, která v registru skutečně stojí. `settings-general`
 * chce `workspace:update`, takže prohlížející položku „Projekt" v menu neuvidí,
 * i když obrazovku samotnou vidět má (stav S12). Je to nález N57 na straně P05;
 * P06 se do té doby řídí registrem, jak je, a testy to popisují pravdivě.
 *
 * Popisky nesou klíč **plnou cestou** (`common.nav.settingsMembers`) a leží
 * v katalogu `common`, který vlastní P05. Klíč se nepřipojuje ani neořezává,
 * předává se tak, jak v registru je, takže zákaz skládání klíčů za běhu
 * (kritérium 71 části 6) platí dál.
 */
export function SettingsNav({ workspaceSlug, permissions }: SettingsNavProps) {
  const t = useTranslations('settings');
  const tRoot = useTranslations();
  const pathname = usePathname();

  const settings = visibleNavigation({
    permissions: [...permissions],
    workspaceSlug,
  }).find((section) => section.id === 'settings');
  const items = settings?.children ?? [];

  // Celá sekce zmizela, protože uživatel nemá ani jednu podpoložku.
  if (items.length === 0) return null;

  return (
    // `Card` umí `section`, `div`, `article` a `aside`, ne `nav`. Landmark je
    // proto obal a karta je uvnitř; obojí najednou by znamenalo sáhnout do
    // `packages/ui`, který vlastní agent základu.
    <nav aria-label={t('nav.sectionLabel')} className="sticky top-[var(--spacing-page)]">
      <Card
        as="div"
        padding="sm"
        gap="stack"
        // Podtržení odkazu kreslí předek, takže `no-underline` musí sedět na
        // obalu nebo na samotném `<a>`. Na potomkovi uvnitř odkazu by nezabralo.
        className="[&_a]:no-underline"
      >
        <p className="meta-caps text-text-muted">{t('nav.sectionLabel')}</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const href = item.href;
            const current = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={item.id}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    // 44 px je nejmenší klikací plocha. Návrh má podpoložky menu
                    // nižší, ale přístupnost má přednost (vědomá odchylka).
                    'flex min-h-[var(--size-target-min)] items-center',
                    'rounded-[var(--radius-control)] px-[var(--spacing-inline)] text-ui',
                    current
                      ? // Vybraná položka nese žlutou plochu, stejně jako vybraný
                        // řádek tabulky. Je to jediná identitní barva systému.
                        'bg-accent-surface font-semibold text-text'
                      : 'text-text-muted hover:bg-surface-muted hover:text-text',
                  )}
                >
                  {tRoot(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </nav>
  );
}
