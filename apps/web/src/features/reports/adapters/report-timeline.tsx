'use client';

import {
  Timeline,
  type TimelineEvent,
  type TimelineGender,
  type TimelineIcon,
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
  /**
   * Výčet se sem NEOPISUJE, bere se z komponenty časové osy. Dvě kopie téhož
   * seznamu by znamenaly, že přidaná ikona projde tady a spadne až tam.
   */
  icon: TimelineIcon;
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

  /*
   * IKONA A VĚTA JDOU POJMENOVANÝMI POLI, ne v `payload`.
   *
   * Do 7. 8. 2026 se ikona ukládala do `payload.icon` a komponenta ji nikdy
   * nepřečetla, takže se u každé události kreslila ikona řetězu. `payload` je
   * `Record<string, unknown>`, tedy volný pytel: vložit do něj jde cokoli a na
   * druhém konci nikdo nepozná, že to nikdo nevybírá, takže na to neupozornila
   * ani typová kontrola. `title` zůstává i v `payload`, protože z něj skládá
   * větu `renderSentence`; pojmenované pole je pro `aria-label` kotvy.
   */
  const events: TimelineEvent[] = props.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    occurredAt: new Date(entry.occurredAt),
    icon: entry.icon,
    title: entry.title,
    payload: {
      title: entry.title,
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
