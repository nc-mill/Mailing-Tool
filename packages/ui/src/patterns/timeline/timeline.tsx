'use client';

import {
  Globe,
  Info,
  Link,
  Mail,
  MailOpen,
  MousePointerClick,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from '../../icons';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { clusterEvents } from './cluster-events';
import { groupByDay } from './day-groups';
import { useAnchoredBatches } from './use-anchored-batches';
import type { TimelineEvent, TimelineIcon } from './types';

/**
 * Význam události na kresbu. Jediné místo, kde se to rozhoduje.
 *
 * Do 7. 8. 2026 tahle tabulka neexistovala a komponenta kreslila u KAŽDÉ události
 * ikonu řetězu, tedy kotvu odkazu. Uživatel se pak ptal, co ta ikona dělá: nešlo
 * z ní poznat, jestli šlo o odeslaný e-mail, proklik nebo odvolaný souhlas.
 */
const ICONS: Record<TimelineIcon, LucideIcon> = {
  mail: Mail,
  open: MailOpen,
  click: MousePointerClick,
  web: Globe,
  contact: UserRound,
  consent: ShieldCheck,
  problem: TriangleAlert,
  generic: Info,
};

export type TimelineGender = 'female' | 'male' | 'other';

export type TimelineLabels = {
  today: string;
  yesterday: string;
  loadOlder: string;
  expandCluster: (count: number) => string;
  collapseCluster: string;
  expanded: string;
  collapsed: string;
  /**
   * Jméno trvalé kotvy pro čtečku a hlasové ovládání.
   *
   * Do 7. 8. 2026 tu bylo doslova `#event-019fdb…`, tedy identifikátor z databáze.
   * Čtečka ho hláskovala po znacích a hlasovým ovládáním se odkaz nedal vyvolat
   * vůbec, protože jeho jméno nešlo vyslovit.
   *
   * `what` je věta o události, `when` datum a čas. Skládá je katalog jako jednu
   * ICU zprávu, ne kód zřetězením.
   */
  eventAnchor: (input: { what: string; when: string }) => string;
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
  renderMeta,
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
  /**
   * Druhý řádek události: mono 12 px pod větou. Nese podrobnost, která do
   * věty nepatří, například kterou kampaň nebo který odkaz se to týkalo.
   * Bez téhle funkce zůstane řádek jednořádkový a nic se nezmění.
   */
  renderMeta?: (input: { event: TimelineEvent }) => React.ReactNode;
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
    const EventIcon = ICONS[event.icon ?? 'generic'];
    return (
      <li
        key={event.id}
        id={`event-${event.id}`}
        data-testid={`timeline-item-${event.id}`}
        className={cn(
          'grid items-center gap-[var(--spacing-stack)]',
          'grid-cols-[minmax(var(--size-timeline-time),auto)_auto_minmax(0,1fr)_var(--size-timeline-anchor)]',
          'border-t border-border py-[var(--spacing-row-y)]',
          // Doskok na kotvu musí být VIDĚT. Bez tohohle prohlížeč posunul stránku
          // na řádek, u kterého člověk často už stál, nic se nezměnilo a odkaz
          // vypadal jako rozbité tlačítko. Žlutá plocha je tatáž, jakou nese
          // vybraný řádek tabulky, tedy jediná identitní barva systému.
          'target:bg-accent-surface',
          // Odsazení platí VŽDY, ne jen v cíli: bez něj by řádek doskočil pod
          // lepivý nadpis dne a schoval se přesně ten, na který se míří.
          '[scroll-margin-block-start:var(--spacing-page)]',
        )}
      >
        <time
          dateTime={event.occurredAt.toISOString()}
          className="font-mono text-meta whitespace-nowrap text-text-muted"
        >
          {formatTime(event.occurredAt)}
        </time>
        {/* Ikona nese význam události, ale NIKDY ho nenese sama: vedle ní stojí
            celá věta, takže je pro čtečku skrytá. */}
        <EventIcon
          aria-hidden
          data-testid={`timeline-icon-${event.id}`}
          data-icon={event.icon ?? 'generic'}
          className="icon-sm text-text-muted"
        />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-ui text-text">{renderSentence({ event, gender })}</span>
          {renderMeta ? (
            <span className="font-mono text-label text-text-muted">{renderMeta({ event })}</span>
          ) : null}
        </span>
        {/* Trvalá kotva: odkaz jde poslat kolegovi a otevře se na téhle položce.
            Rámeček naskočí až při najetí, aby padesát řádků pod sebou
            nevypadalo jako sloupec tlačítek.

            ZŮSTÁVÁ TO ODKAZ, ne tlačítko „zkopírovat adresu". Zvažovalo se to
            7. 8. 2026 a rozhodlo se proti: kopírování do schránky po kliknutí
            přepisuje schránku bez vyzvání, rozchází se s tím, co člověk od
            podtrženého odkazu čeká, a zabilo by nativní „Kopírovat adresu
            odkazu" z pravého tlačítka i otevření do nového panelu. Účel kotvy
            se projeví i tak: adresa naskočí do řádku prohlížeče a cílová
            událost se zvýrazní (`target:` výš). */}
        <a
          href={`#event-${event.id}`}
          aria-label={labels.eventAnchor({
            what: event.title ?? '',
            when: `${formatDate(event.occurredAt)} ${formatTime(event.occurredAt)}`,
          })}
          className={cn(
            'flex size-[var(--size-control-2xs)] items-center justify-center justify-self-center',
            'rounded-[var(--radius-control)] border border-transparent text-text-muted no-underline',
            'hover:border-border-strong hover:text-text',
          )}
        >
          <Link aria-hidden className="icon-sm" />
        </a>
      </li>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex flex-col gap-[var(--spacing-stack)] overflow-auto', className)}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {days.map((day) => (
        <section key={day.key}>
          {/* Oddělovač dne je mezinadpis, ne položka seznamu, a neposouvá se. */}
          <h3 className="meta-caps sticky top-0 z-[var(--z-sticky)] bg-surface py-2.5 text-text-muted">
            {day.label === 'today'
              ? labels.today
              : day.label === 'yesterday'
                ? labels.yesterday
                : formatDate(day.date)}
          </h3>

          <ul>
            {day.items.map((item) => {
              if (item.kind === 'single') return renderEvent(item.event);

              const isOpen = expanded.has(item.id);
              return (
                <li key={item.id} className="border-t border-border">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleCluster(item.id)}
                    className={cn(
                      'grid w-full grid-cols-[minmax(var(--size-timeline-time),auto)_minmax(0,1fr)] items-center text-left',
                      'min-h-[var(--size-target-min)] gap-[var(--spacing-stack)] py-[var(--spacing-row-y)]',
                    )}
                  >
                    {/* Skrytý z názvu tlačítka pro čtečku, jinak by k němu splynul čas. */}
                    <time
                      aria-hidden
                      dateTime={item.occurredAt.toISOString()}
                      className="font-mono text-meta whitespace-nowrap text-text-muted"
                    >
                      {formatTime(item.occurredAt)}
                    </time>
                    <span className="text-ui text-text">
                      {isOpen ? labels.collapseCluster : labels.expandCluster(item.events.length)}
                    </span>
                  </button>
                  {isOpen ? (
                    <ul className="pl-[calc(var(--size-timeline-time)+var(--spacing-stack))]">
                      {item.events.map(renderEvent)}
                    </ul>
                  ) : null}
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
            className="min-h-[var(--size-target-min)] rounded-[var(--radius-control)] border border-border-strong px-4 text-ui text-text"
          >
            {labels.loadOlder}
          </button>
        </div>
      ) : null}
    </div>
  );
}
