/**
 * Typy událostí, které smí endpoint odebírat.
 *
 * ZDROJ PRAVDY JE KATALOG V JÁDŘE: `packages/core/src/platform/webhooks/event-catalog.ts`.
 * Stránky si ho načtou samy a předají formuláři v `availableEventTypes`.
 * Tenhle soubor drží jen rozdělení do skupin, aby výběr patnácti položek nebyl
 * jeden dlouhý sloupec.
 *
 * PROČ SE KATALOG NEIMPORTUJE ROVNOU TADY: soubor čte klientská komponenta
 * formuláře, takže všechno, co v něm stojí, končí v klientském balíku. Seznam
 * do stránky patří ze serveru, ne z bundleru.
 *
 * Dřív tu stál ručně opsaný `MVP0_EVENT_TYPES` se třemi typy. Produkt jich
 * mezitím vydával patnáct a jeden ze tří opsaných (`contact.created`)
 * nevydával nikdo, takže kdo si ho zaškrtl, čekal navždy. Rozdíl hlídá
 * `packages/core/src/platform/webhooks/event-catalog.test.ts`.
 */
export type EventTypeGroup = {
  /** Prefix typu, například `contact`. Je to zároveň identifikátor skupiny. */
  prefix: string;
  types: string[];
};

export function groupEventTypes(types: readonly string[]): EventTypeGroup[] {
  const groups = new Map<string, string[]>();
  for (const type of types) {
    const prefix = type.split('.')[0] ?? type;
    const bucket = groups.get(prefix);
    if (bucket) bucket.push(type);
    else groups.set(prefix, [type]);
  }
  return [...groups.entries()]
    .map(([prefix, groupTypes]) => ({ prefix, types: groupTypes.toSorted() }))
    .toSorted((left, right) => left.prefix.localeCompare(right.prefix));
}

/** Maximum typů na endpoint podle 3.8 části 1. */
export const EVENT_TYPES_PER_ENDPOINT_LIMIT = 50;
