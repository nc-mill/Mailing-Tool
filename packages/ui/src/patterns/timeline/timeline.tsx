'use client';

import { Link2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { clusterEvents } from './cluster-events';
import { groupByDay } from './day-groups';
import { useAnchoredBatches } from './use-anchored-batches';
import type { TimelineEvent } from './types';

export type TimelineGender = 'female' | 'male' | 'other';

export type TimelineLabels = {
  today: string;
  yesterday: string;
  loadOlder: string;
  expandCluster: (count: number) => string;
  collapseCluster: string;
  expanded: string;
  collapsed: string;
};

const CLUSTER_WINDOW_MS = 5 * 60 * 1000;
const CLUSTER_MIN_SIZE = 3;
/** E-mailové události jsou to podstatné, nikdy se neshlukují. */
const NEVER_CLUSTER = ['email_delivered', 'email_open', 'email_click', 'consent_given'];

export function Timeline({
  events,
  gender,
  timeZone,
  now,
  labels,
  renderSentence,
  formatTime,
  formatDate,
  hasMore,
  onLoadOlder,
  className,
}: {
  /** Seřazené od nejnovější. */
  events: TimelineEvent[];
  /** Rod kontaktu z pole `gender`. Neznámý rod dostane podstatné jméno. */
  gender: TimelineGender;
  /** Časová zóna uživatele, ne serveru. */
  timeZone: string;
  now?: Date;
  labels: TimelineLabels;
  /**
   * Věta se skládá v katalogu jako **jedna ICU zpráva se `select` nad celou
   * větou**, ne z fragmentů. Komponenta jen předá událost a rod.
   */
  renderSentence: (input: { event: TimelineEvent; gender: TimelineGender }) => React.ReactNode;
  formatTime: (value: Date) => string;
  formatDate: (value: Date) => string;
  hasMore: boolean;
  onLoadOlder: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { beforeLoad } = useAnchoredBatches({ containerRef });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const items = clusterEvents(events, {
    windowMs: CLUSTER_WINDOW_MS,
    minSize: CLUSTER_MIN_SIZE,
    neverCluster: NEVER_CLUSTER,
  });
  const days = groupByDay(items, now === undefined ? { timeZone } : { timeZone, now });

  function toggleCluster(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        setAnnouncement(labels.collapsed);
      } else {
        next.add(id);
        setAnnouncement(labels.expanded);
      }
      return next;
    });
  }

  function renderEvent(event: TimelineEvent) {
    return (
      <li
        key={event.id}
        id={`event-${event.id}`}
        data-testid={`timeline-item-${event.id}`}
        className="flex items-baseline gap-3 py-2"
      >
        <time
          dateTime={event.occurredAt.toISOString()}
          className="w-14 shrink-0 font-mono text-sm text-text-muted"
        >
          {formatTime(event.occurredAt)}
        </time>
        <span className="flex-1 text-sm text-text">{renderSentence({ event, gender })}</span>
        {/* Trvalá kotva: odkaz jde poslat kolegovi a otevře se na téhle položce. */}
        <a
          href={`#event-${event.id}`}
          aria-label={`#event-${event.id}`}
          className="flex size-11 items-center justify-center text-text-muted"
        >
          <Link2 aria-hidden className="size-4" />
        </a>
      </li>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex flex-col gap-4 overflow-auto', className)}>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {days.map((day) => (
        <section key={day.key}>
          {/* Oddělovač dne je mezinadpis, ne položka seznamu, a neposouvá se. */}
          <h3 className="sticky top-0 z-[var(--z-sticky)] bg-surface py-1 text-sm font-medium text-text-muted">
            {day.label === 'today'
              ? labels.today
              : day.label === 'yesterday'
                ? labels.yesterday
                : formatDate(day.date)}
          </h3>

          <ul className="divide-y divide-border">
            {day.items.map((item) => {
              if (item.kind === 'single') return renderEvent(item.event);

              const isOpen = expanded.has(item.id);
              return (
                <li key={item.id} className="py-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleCluster(item.id)}
                    className="flex min-h-11 w-full items-baseline gap-3 text-left"
                  >
                    {/* Skrytý z názvu tlačítka pro čtečku, jinak by k němu splynul čas. */}
                    <time
                      aria-hidden
                      dateTime={item.occurredAt.toISOString()}
                      className="w-14 shrink-0 font-mono text-sm text-text-muted"
                    >
                      {formatTime(item.occurredAt)}
                    </time>
                    <span className="flex-1 text-sm text-text">
                      {isOpen ? labels.collapseCluster : labels.expandCluster(item.events.length)}
                    </span>
                  </button>
                  {isOpen ? <ul className="pl-14">{item.events.map(renderEvent)}</ul> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasMore ? (
        <div>
          <button
            type="button"
            onClick={() => {
              beforeLoad();
              onLoadOlder();
            }}
            className="min-h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm text-text"
          >
            {labels.loadOlder}
          </button>
        </div>
      ) : null}
    </div>
  );
}
