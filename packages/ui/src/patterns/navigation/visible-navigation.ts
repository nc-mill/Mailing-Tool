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
}: {
  permissions: string[];
  workspaceSlug?: string;
  includeReserved?: boolean;
  /** Až budou obrazovky hotové, přepne se tohle na `true` a příznaky zmizí. */
  includeNonMvp0?: boolean;
}): VisibleNavigationItem[] {
  const allowed = new Set(permissions);
  const base = `/w/${workspaceSlug}`;

  function keep(item: NavigationItem): boolean {
    if (item.reservedFor !== undefined && !includeReserved) return false;
    // Cesta, kterou v MVP 0 nikdo nenaplní, se nenabízí. Prázdná stránka
    // je horší než chybějící položka.
    if (!item.mvp0 && !includeNonMvp0) return false;
    if (item.permission === undefined) return true;
    return allowed.has(item.permission);
  }

  const result: VisibleNavigationItem[] = [];

  for (const section of NAVIGATION) {
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
      ...(children.length > 0 ? { children } : {}),
    });
  }

  return result;
}
