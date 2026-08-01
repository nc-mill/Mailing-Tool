/**
 * Typy událostí, které smí endpoint odebírat. Zdrojem pravdy je backend,
 * proto se seznam načítá z API. Tenhle soubor drží jen tvar a rozdělení do
 * skupin, aby výběr padesáti položek nebyl jeden dlouhý sloupec.
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

/**
 * ODCHYLKA OD PLÁNU, vynucená stavem API: plán počítal s tím, že se seznam
 * typů načte z backendu, jenže endpoint, který by ho vydal, v OpenAPI není
 * (ověřeno výpisem 33 cest běžící instance) a `packages/contracts/webhooks/`
 * zatím neexistuje. Formulář by tedy nenabídl ani jeden typ a webhook by
 * nešlo vytvořit vůbec.
 *
 * Do doby, než registr vznikne, se používá seznam z předávky P2-4 v 01-platforma.md.
 * Backend typy nevaliduje proti výčtu, takže rozšíření seznamu je změna
 * jednoho pole tady, ne zásah do cizího plánu.
 */
export const MVP0_EVENT_TYPES = [
  'contact.created',
  'contact.subscribed',
  'contact.unsubscribed',
] as const;
