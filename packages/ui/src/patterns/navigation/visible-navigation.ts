import { NAVIGATION, type NavigationItem } from './registry';

/**
 * `children` se přepisuje, ne rozšiřuje: podpoložky už mají doplněnou cestu.
 * Bez `Omit` by průnik typů udělal z `children` obojí naráz a sidebar by
 * u podpoložky cestu neviděl.
 */
export type VisibleNavigationItem = Omit<NavigationItem, 'children'> & {
  href: string;
  children?: VisibleNavigationItem[];
};

/**
 * Odfiltruje položky, na které uživatel nemá oprávnění, a doplní cestu
 * se slugem projektu. Sekce bez jediné viditelné podpoložky zmizí celá.
 *
 * Skrývá se **jen navigace**. Akce uvnitř obrazovky se nikdy neskrývají,
 * ty se vysvětlují (pravidlo 2 ze 7.2b).
 */
export function visibleNavigation({
  permissions,
  workspaceSlug = '{slug}',
  includeReserved = false,
  includeNonMvp0 = false,
  hiddenIds = [],
}: {
  permissions: string[];
  workspaceSlug?: string;
  includeReserved?: boolean;
  /** Až budou obrazovky hotové, přepne se tohle na `true` a příznaky zmizí. */
  includeNonMvp0?: boolean;
  /**
   * Položky, které tenhle projekt vypnul v nastavení.
   *
   * Je to úzká výjimka z pravidla „registr je celý dopředu", ne rozšíření
   * registru: položka v něm zůstává i s cestou a oprávněním, jen se pro daný
   * projekt nenabízí. Zavedl to vypínač oslovení a 5. pádu
   * (`workspaces.greeting_enabled`), který skrývá obrazovku
   * `/contacts/vocative-review`. Kdyby se skryla jen obrazovka a ne položka,
   * zbylo by v menu mrtvé tlačítko.
   *
   * Rozhoduje se tady, ne příznakem v registru, protože podmínka je vlastnost
   * PROJEKTU, kdežto registr je statický a nezná ani projekt, ani jeho nastavení.
   */
  hiddenIds?: readonly string[];
}): VisibleNavigationItem[] {
  const allowed = new Set(permissions);
  const hidden = new Set(hiddenIds);
  const base = `/w/${workspaceSlug}`;

  function keep(item: NavigationItem): boolean {
    if (hidden.has(item.id)) return false;
    if (item.reservedFor !== undefined && !includeReserved) return false;
    // Cesta, kterou v MVP 0 nikdo nenaplní, se nenabízí. Prázdná stránka
    // je horší než chybějící položka.
    if (!item.mvp0 && !includeNonMvp0) return false;
    if (item.permission === undefined) return true;
    return allowed.has(item.permission);
  }

  const result: VisibleNavigationItem[] = [];

  for (const section of NAVIGATION) {
    if (hidden.has(section.id)) continue;
    if (section.reservedFor !== undefined && !includeReserved) continue;
    if (!section.mvp0 && !includeNonMvp0) continue;

    // Třetí úroveň registr nemá a sidebar ji nevykresluje, takže se
    // do viditelného stromu nepřenáší.
    const children = (section.children ?? [])
      .filter(keep)
      .map(({ children: _nested, ...child }) => ({
        ...child,
        href: `${base}${child.path}`,
      }));

    // Sekce s podpoložkami zmizí, když nezbyla ani jedna.
    if ((section.children?.length ?? 0) > 0 && children.length === 0) continue;
    // Sekce bez podpoložek se řídí vlastním oprávněním.
    if ((section.children?.length ?? 0) === 0 && !keep(section)) continue;

    /*
     * PODMENU O JEDNÉ POLOŽCE, KTERÁ VEDE TAM CO SEKCE, SE NEVYKRESLUJE.
     *
     * Šipka slibuje volbu. Když je pod ní jediná položka a míří na tutéž cestu
     * jako sekce sama, žádná volba tam není: obojí vede na stejnou obrazovku.
     * Přesně to se stalo u Kampaní a Šablon, kterým druhá podpoložka odpadla
     * (neexistující obrazovka), takže zbylo podmenu s jediným odkazem na sekci.
     *
     * Návrh to má stejně: podmenu má JEDINÁ sekce, Kontakty, a má sedm položek.
     * Zbytek jsou obyčejné odkazy, včetně Kampaní a Šablon.
     *
     * Podmínka je ZÁMĚRNĚ úzká, tedy „jedna A na téže cestě", ne „jedna".
     * NEROZŠIŘUJ ji. Jediná podpoložka, která míří JINAM než sekce, je pro
     * uživatele jediná cesta na tu obrazovku: sekce vede jinam a bez podmenu
     * by se na ni nedostal nijak.
     *
     * Živý doklad tu do 6. 8. 2026 byl. Nastavení měla podpoložku „Můj účet"
     * bez oprávnění, takže prohlížejícímu zbyla jediná a mířila jinam než
     * sekce; širší pravidlo by mu ji sebralo. Ta položka se mezitím přesunula
     * do nabídky v pravém horním rohu, takže případ v aplikaci momentálně
     * nenastává. To ale není důvod pravidlo změkčit, jen to znamená, že se to
     * stane znovu a nebude si to nikdo pamatovat. Hlídá to test „jediná
     * podpoložka mířící JINAM než sekce zůstane" na sestaveném vstupu.
     *
     * Filtruje se to tady, ne v registru, aby to platilo i pro sekci, které
     * podpoložky ubere oprávnění nebo skrytí. Registr dál popisuje, co kam
     * patří; tohle rozhoduje, co má smysl ukázat.
     */
    const sectionHref = `${base}${section.path}`;
    const redundantSingle = children.length === 1 && children[0]?.href === sectionHref;
    const submenu = redundantSingle ? [] : children;

    // Klíč `children` se nenastavuje na undefined, ale vůbec nevzniká:
    // sekce bez podpoložek nemá prázdný seznam, který by šel omylem projít.
    result.push({
      id: section.id,
      labelKey: section.labelKey,
      path: section.path,
      mvp0: section.mvp0,
      href: `${base}${section.path}`,
      ...(section.permission === undefined ? {} : { permission: section.permission }),
      ...(section.reservedFor === undefined ? {} : { reservedFor: section.reservedFor }),
      /*
       * Příznak se PŘENÁŠÍ, podpoložky se nezahazují.
       *
       * Rozhodnout to tady a vrátit sekci bez dětí by vypadalo úsporněji, ale
       * `children` čte i navigace UVNITŘ Nastavení (`settings-nav.tsx`), té by
       * tím zmizel obsah. A jsou z nich spočítané dvě věci, na kterých závisí
       * boční menu samo: jestli se sekce vůbec nabízí a jestli svítí jako
       * otevřená, když uživatel stojí na podstránce, která neleží pod cestou
       * sekce (`/settings/audit` není pod `/settings/general`).
       *
       * Tenhle soubor tedy říká, CO uživatel smí vidět. Kolik z toho vykreslí
       * boční menu, rozhoduje `Sidebar`.
       */
      ...(section.sidebarSubmenu === undefined ? {} : { sidebarSubmenu: section.sidebarSubmenu }),
      ...(submenu.length > 0 ? { children: submenu } : {}),
    });
  }

  return result;
}
