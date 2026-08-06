'use client';

import {
  Timeline,
  type TimelineEvent,
  type TimelineGender,
  type TimelineLabels,
} from '@mlain/ui/patterns/timeline';

/**
 * Položka osy tak, jak ji vrací `/api/v1/contacts/{id}/timeline`. Větu skládá
 * server (R17), takže `title` je hotový text a klient ho už jen zobrazí.
 */
export type TimelineEntry = {
  id: string;
  occurredAt: string;
  type: string;
  title: string;
  icon: 'mail' | 'open' | 'click' | 'web' | 'contact' | 'consent' | 'problem' | 'generic';
  reliability?: 'confirmed' | 'machine';
  detail?: Record<string, unknown>;
};

export type ReportTimelineProps = {
  entries: TimelineEntry[];
  /**
   * Druhý řádek události, mono 12 px pod větou. Skládá ho volající z `detail`,
   * protože jen on ví, co je v téhle sestavě podstatné. Bez něj zůstane řádek
   * jednořádkový, tedy přesně jako dřív.
   */
  renderMeta?: (entry: TimelineEntry) => React.ReactNode;
  /** Rod kontaktu z pole `gender`. Neznámý rod dostane podstatné jméno. */
  gender: TimelineGender;
  /** Zóna uživatele, ne serveru. Oddělovače dnů se počítají v ní. */
  timeZone: string;
  labels: TimelineLabels;
  formatTime: (value: Date) => string;
  formatDate: (value: Date) => string;
  hasMore: boolean;
  onLoadOlder: () => void;
};

/**
 * Jediné místo, kde se reporty dotýkají komponenty K8.
 *
 * Shlukování sérií, oddělovače dnů v zóně uživatele, dávky bez skoku scrollu
 * i kotvy jsou uvnitř K8 a tenhle soubor je neřeší. Překládá jen dvě věci:
 * ISO řetězec z API na `Date`, který K8 očekává, a hotový `title` na uzel,
 * který K8 vykreslí přes `renderSentence`.
 *
 * `renderSentence` bere K8 jako props schválně: věta se skládá jako JEDNA
 * ICU zpráva se `select` nad celou větou, ne z fragmentů. Tady ji jen podáme,
 * protože ji podle R17 složil server.
 */
export function ReportTimeline(props: ReportTimelineProps) {
  // Původní položka podle id: `renderMeta` z K8 dostane událost K8, ne řádek
  // z API, a druhý řádek se skládá právě z `detail`, které do věty nepatří.
  const byId = new Map(props.entries.map((entry) => [entry.id, entry]));

  const events: TimelineEvent[] = props.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    occurredAt: new Date(entry.occurredAt),
    payload: {
      title: entry.title,
      icon: entry.icon,
      ...(entry.reliability ? { reliability: entry.reliability } : {}),
      ...(entry.detail ? { detail: entry.detail } : {}),
    },
  }));

  return (
    <Timeline
      events={events}
      gender={props.gender}
      timeZone={props.timeZone}
      labels={props.labels}
      renderSentence={({ event }) => String(event.payload.title ?? '')}
      {...(props.renderMeta === undefined
        ? {}
        : {
            renderMeta: ({ event }: { event: TimelineEvent }) => {
              const entry = byId.get(event.id);
              return entry === undefined ? null : props.renderMeta?.(entry);
            },
          })}
      formatTime={props.formatTime}
      formatDate={props.formatDate}
      hasMore={props.hasMore}
      onLoadOlder={props.onLoadOlder}
    />
  );
}
