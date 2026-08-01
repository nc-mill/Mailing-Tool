import type { TimelineEvent, TimelineItem } from './types';

/**
 * Shlukování sérií stejného typu v krátkém okně do jednoho rozbalitelného
 * řádku s počtem. Bez toho časovou osu zaplaví web tracking a e-mailové
 * události v ní zmizí.
 *
 * Vstup je seřazený od nejnovější události. Výstup si pořadí drží.
 */
export function clusterEvents(
  events: TimelineEvent[],
  {
    windowMs,
    minSize,
    neverCluster = [],
  }: {
    /** Jak blízko u sebe musí události být, aby se spojily. */
    windowMs: number;
    /** Kolik událostí musí být, aby se vůbec shlukovaly. */
    minSize: number;
    /** Typy, které se nikdy neshlukují, protože jsou to ty důležité. */
    neverCluster?: string[];
  },
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let index = 0;

  while (index < events.length) {
    const first = events[index];
    if (!first) break;

    if (neverCluster.includes(first.type)) {
      items.push({
        kind: 'single',
        id: first.id,
        type: first.type,
        occurredAt: first.occurredAt,
        event: first,
      });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < events.length) {
      const next = events[end];
      if (!next || next.type !== first.type) break;
      if (Math.abs(first.occurredAt.getTime() - next.occurredAt.getTime()) > windowMs) break;
      end += 1;
    }

    const group = events.slice(index, end);
    if (group.length >= minSize) {
      items.push({
        kind: 'cluster',
        id: `cluster-${first.id}`,
        type: first.type,
        // Shluk drží čas nejnovější události, aby seděl v pořadí osy.
        occurredAt: first.occurredAt,
        events: group,
      });
    } else {
      for (const event of group) {
        items.push({
          kind: 'single',
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          event,
        });
      }
    }
    index = end;
  }

  return items;
}
