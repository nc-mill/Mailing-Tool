'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft } from '../../icons';
import { cn } from '../../lib/cn';
import { sectionIcon } from '../navigation/section-icons';
import type { VisibleNavigationItem } from '../navigation/visible-navigation';

export type SidebarLabels = {
  mainNavigation: string;
  /** Popis tlačítka, když je menu rozbalené a kliknutím se zabalí. */
  collapse: string;
  /** Popis tlačítka, když je menu zabalené a kliknutím se rozbalí. */
  expand: string;
  /** Popis šipky u sekce, například „Rozbalit podpoložky Kontaktů". */
  toggleSection: (section: string) => string;
};

/**
 * Boční menu.
 *
 * Tmavé v obou motivech: v návrhu je tmavý panel prvek identity, ne důsledek
 * světlého nebo tmavého režimu. Proto se barvy berou z tokenů `--color-panel*`,
 * které se s motivem nemění.
 *
 * ZABALENÍ NA IKONY. Rozbalené menu ukazuje ikonu, název, počet a šipku
 * a podpoložky se rozbalují pod položkou. Zabalené menu ukazuje jen ikonu
 * a podpoložky se otevírají ve VYSOUVACÍM PANELU vedle: v 76 px širokém
 * sloupci není kam odsadit druhou úroveň, takže by se buď nevešla, nebo by
 * splynula s první.
 *
 * Vysouvací panel má vlevo větší vnitřní okraj (24 px) a je posunutý o 12 px
 * doleva pod položku. Vzniká tím pruh, přes který myš dojede z položky do
 * panelu, aniž by mezitím opustila obojí a panel se zavřel.
 *
 * Panel se otevírá i FOKUSEM, ne jen myší: bez toho by se ke druhé úrovni
 * v zabaleném menu nedalo dostat z klávesnice. Zavírá ho Escape.
 */
export function Sidebar({
  items,
  currentPath,
  collapsed,
  counts,
  onToggleCollapse,
  translate,
  renderLink,
  labels,
  footer,
}: {
  items: VisibleNavigationItem[];
  currentPath: string;
  collapsed: boolean;
  /** Počet u položky menu, klíčem je `id` sekce. Chybějící počet se nevypisuje. */
  counts?: Record<string, number> | undefined;
  /** Bez téhle funkce se tlačítko zabalení nevykreslí a menu zůstane rozbalené. */
  onToggleCollapse?: (() => void) | undefined;
  translate: (labelKey: string) => string;
  /** Odkaz dodává aplikace, aby `packages/ui` nezáviselo na routeru. */
  renderLink: (input: {
    href: string;
    label: string;
    active: boolean;
    children: React.ReactNode;
  }) => React.ReactNode;
  labels: SidebarLabels;
  /** Patička menu, například odkaz na zdrojový kód. */
  footer?: React.ReactNode;
}) {
  const isActive = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);

  /**
   * Je uživatel v téhle sekci?
   *
   * Přehled se pozná JEN podle přesné shody. Jeho cesta je kořen projektu
   * (`/w/{slug}`), takže předponu má společnou s každou jinou stránkou:
   * kdyby se počítala, svítil by Přehled jako otevřená sekce i v Nastavení
   * a podpoložky Nastavení by se vůbec nerozbalily.
   *
   * Podpoložky se hledají zvlášť, protože nemusí ležet pod cestou sekce.
   * Pod Kontakty patří i `/lists` a `/segments`.
   */
  const isSectionActive = (section: VisibleNavigationItem) =>
    currentPath === section.href ||
    (section.path !== '' && isActive(section.href)) ||
    (section.children?.some((child) => isActive(child.href)) ?? false);

  /** Sekce rozbalené uživatelem. `undefined` znamená „řídí se tím, kde stojím". */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zabalení menu zavře otevřený panel. Bez toho by po rozbalení zůstal viset
  // vedle položky panel, který v rozbaleném menu nemá co dělat.
  useEffect(() => {
    setFlyout(null);
  }, [collapsed]);

  useEffect(() => {
    if (flyout === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFlyout(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [flyout]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const openFlyout = (id: string) => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    if (collapsed) setFlyout(id);
  };

  // Zavření se o chvíli odloží, aby cesta myší z položky do panelu
  // nezavřela panel v půlce.
  const scheduleClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(null), 120);
  };

  return (
    <div
      className={cn(
        'sticky top-[var(--size-topbar)] z-[var(--z-sidebar)] h-[calc(100dvh-var(--size-topbar))] shrink-0',
        'transition-[width] duration-[var(--duration-nav)]',
        collapsed ? 'w-[var(--size-sidebar-collapsed)]' : 'w-[var(--size-sidebar)]',
      )}
    >
      <nav
        aria-label={labels.mainNavigation}
        className={cn(
          'on-panel flex h-full w-full flex-col gap-[var(--spacing-card)]',
          'bg-panel text-panel-foreground',
          // Odkazy v menu se nepodtrhávají. Globální podtržení odkazu platí
          // pro text, kde je odkaz mezi slovy a musí se poznat. V navigaci
          // je odkazem každá položka, takže podtržení nic nerozlišuje a jen
          // rozbíjí řádek. Podtržení sedí na `<a>`, které dodává aplikace,
          // proto se ruší odsud a ne třídou na vnitřním prvku: podtržení
          // předka jde skrz potomky a potomek ho zrušit neumí.
          '[&_a]:no-underline',
          'transition-[padding] duration-[var(--duration-nav)]',
          collapsed
            ? 'overflow-visible px-3 py-[var(--spacing-card)]'
            : 'overflow-y-auto px-[var(--spacing-stack)] py-[var(--spacing-card)]',
        )}
      >
        <ul className="grid gap-0.5">
          {items.map((section) => {
            const label = translate(section.labelKey);
            const sectionActive = isSectionActive(section);
            const Icon = sectionIcon(section.id);
            const count = counts?.[section.id];
            const expanded = opened[section.id] ?? sectionActive;

            return (
              <li
                key={section.id}
                className="relative"
                onMouseEnter={() => openFlyout(section.id)}
                onMouseLeave={scheduleClose}
                // FOKUS SE HLÍDÁ TADY, na položce, ne na odkazu uvnitř.
                // Zaostření nebublá, kdežto `onFocus` v Reactu je `focusin`,
                // které bublá. Dokud handler seděl na `<span>` UVNITŘ odkazu,
                // nespustilo ho zaostření samotného odkazu, takže se ke druhé
                // úrovni zabaleného menu z klávesnice nedalo dostat vůbec.
                onFocus={() => openFlyout(section.id)}
                // Odchod fokusu panel zavírá se stejným odkladem jako odchod
                // myši: přesun z položky do panelu jde přes krátký stav,
                // kdy fokus nemá ani jedno.
                onBlur={scheduleClose}
              >
                <div
                  className={cn(
                    // OZNAČENÍ NESE ŘÁDEK, ne odkaz uvnitř něj. Plocha, žlutý
                    // proužek i rádius patří sem, protože v návrhu jde označení
                    // přes CELOU šířku menu, tedy i pod šipku podpoložek.
                    'group flex items-stretch rounded-[var(--radius-control)]',
                    // `length:` je povinné, jinak `tailwind-merge` vezme
                    // hranatou hodnotu za barvu a barva z aktivního stavu
                    // ji tiše přebije; proužek pak vyjde 1 px místo tří.
                    'min-h-[var(--size-target-min)] border-l-[length:var(--border-accent)]',
                    // Odkaz dodává aplikace, takže mu třídu nepředáme přímo.
                    // Bez tohohle je odkaz jako flexový prvek jen tak široký,
                    // jak je dlouhý jeho text, a označení skončí v půlce menu.
                    '[&>a]:min-w-0 [&>a]:flex-1',
                    collapsed ? 'w-[var(--size-nav-item-collapsed)]' : 'w-full',
                    sectionActive
                      ? 'border-l-primary bg-panel-line'
                      : 'border-l-transparent hover:bg-panel-line',
                  )}
                >
                  {renderLink({
                    href: section.href,
                    label,
                    active: sectionActive,
                    children: (
                      <span
                        title={collapsed ? label : undefined}
                        className={cn(
                          'flex min-h-[var(--size-target-min)] w-full items-center gap-3',
                          'py-2.5 text-ui no-underline',
                          collapsed ? 'justify-center px-0' : 'pl-3',
                          // Vnitřní okraj vpravo drží sám odkaz jen tam, kde
                          // za ním nestojí šipka. Se šipkou ho drží tlačítko,
                          // jinak by mezi počtem a šipkou vznikla mezera navíc.
                          !collapsed && !section.children ? 'pr-3' : '',
                          sectionActive
                            ? 'font-semibold text-panel-foreground'
                            : 'text-panel-soft group-hover:text-panel-foreground',
                        )}
                      >
                        <Icon
                          aria-hidden
                          className={cn('icon-lg', sectionActive ? 'text-primary' : '')}
                        />
                        {collapsed ? null : (
                          <>
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {count === undefined ? null : (
                              <span className="font-mono text-label text-panel-muted">{count}</span>
                            )}
                          </>
                        )}
                      </span>
                    ),
                  })}

                  {/* Šipka je SAMOSTATNÉ tlačítko, ne součást odkazu. Odkaz vede
                      na sekci, šipka jen rozbaluje podpoložky. Kdyby to dělal
                      jeden prvek, jedno z toho by uživatel nemohl udělat,
                      aniž by udělal i druhé.

                      Tlačítko je široké jako nejmenší klikací cíl (44 px),
                      kdežto návrh počítá jen se šipkou a odsazením, tedy
                      12 + 16 + 12 = 40 px. Záporný levý okraj ty čtyři pixely
                      navíc vrací odkazu, takže počet i šipka stojí přesně tam,
                      kde je má návrh, a klikací plocha přesto zůstane 44 px. */}
                  {!collapsed && section.children ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={labels.toggleSection(label)}
                      onClick={() =>
                        setOpened((previous) => ({ ...previous, [section.id]: !expanded }))
                      }
                      className={cn(
                        '-ml-1 flex w-[var(--size-target-min)] shrink-0 items-center justify-end',
                        'rounded-r-[var(--radius-control)] pr-3 text-panel-muted',
                      )}
                    >
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          'icon-sm transition-transform duration-[var(--duration-normal)]',
                          expanded ? 'rotate-180' : '',
                        )}
                      />
                    </button>
                  ) : null}
                </div>

                {/* Druhá úroveň v rozbaleném menu: odsazená, oddělená linkou. */}
                {!collapsed && section.children && expanded ? (
                  <ul className="mt-1 mb-1.5 ml-[var(--spacing-stack)] grid gap-0.5 border-l border-panel-line pl-3">
                    {section.children.map((child) => {
                      const childLabel = translate(child.labelKey);
                      return (
                        <li key={child.id}>
                          {renderLink({
                            href: child.href,
                            label: childLabel,
                            active: currentPath === child.href,
                            children: (
                              <span
                                className={cn(
                                  'flex min-h-[var(--size-target-min)] items-center rounded-[var(--radius-control)] px-2.5',
                                  'text-sm no-underline',
                                  // Otevřená podpoložka má VLASTNÍ plochu, ne tu
                                  // od najetí myší: kdyby byly stejné, nešlo by
                                  // poznat, na které stránce uživatel stojí.
                                  currentPath === child.href
                                    ? 'bg-panel-active font-semibold text-panel-foreground'
                                    : 'text-panel-soft hover:bg-panel-line hover:text-panel-foreground',
                                )}
                              >
                                {childLabel}
                              </span>
                            ),
                          })}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {/* Druhá úroveň v zabaleném menu: vysouvací panel vedle. */}
                {collapsed && section.children && flyout === section.id ? (
                  <div
                    onMouseEnter={() => openFlyout(section.id)}
                    onMouseLeave={scheduleClose}
                    className={cn(
                      'on-panel absolute top-[-6px] left-full z-[var(--z-flyout)] -ml-3 grid gap-0.5',
                      'min-w-[var(--size-flyout-min)] rounded-[var(--radius-surface)] bg-panel py-3 pr-3 pl-6',
                      'shadow-flyout',
                    )}
                  >
                    <span className="meta-caps px-2.5 pt-1 pb-2 text-panel-muted">{label}</span>
                    {section.children.map((child) => {
                      const childLabel = translate(child.labelKey);
                      return renderLink({
                        href: child.href,
                        label: childLabel,
                        active: currentPath === child.href,
                        children: (
                          <span
                            className={cn(
                              'flex min-h-[var(--size-target-min)] items-center rounded-[var(--radius-control)] px-2.5',
                              'text-sm no-underline',
                              currentPath === child.href
                                ? 'bg-panel-active text-panel-foreground'
                                : 'text-panel-soft hover:bg-panel-line hover:text-panel-foreground',
                            )}
                          >
                            {childLabel}
                          </span>
                        ),
                      });
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {footer ? (
          <div className="mt-auto border-t border-panel-line pt-[var(--spacing-stack)]">
            {footer}
          </div>
        ) : null}
      </nav>

      {/* Tlačítko zabalení sedí na hraně menu, půlkou přes obsah. Proto je
          `absolute` vůči obalu a ne uvnitř `nav`, kde by ho uřízl `overflow`. */}
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? labels.expand : labels.collapse}
          title={collapsed ? labels.expand : labels.collapse}
          className={cn(
            'absolute top-[var(--size-collapse-offset)] left-full z-[var(--z-flyout)] -ml-3.5 flex size-7 items-center justify-center',
            'on-panel rounded-full border-2 border-panel-foreground bg-panel text-panel-foreground',
          )}
        >
          <ChevronLeft
            aria-hidden
            className={cn(
              'icon-xs transition-transform duration-[var(--duration-nav)]',
              collapsed ? 'rotate-180' : '',
            )}
          />
        </button>
      ) : null}
    </div>
  );
}
