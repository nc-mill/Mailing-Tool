'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import type { TimelineGender } from '@mlain/ui/patterns/timeline';
import { fetchJson, timelineUrl } from '../api-client';
import { ReportTimeline } from '../adapters/report-timeline';
import { groupWebSeries, iconFor, type ApiTimelineItem } from './group-sessions';

const FILTERS = ['all', 'email', 'web', 'contact', 'consent'] as const;
type Filter = (typeof FILTERS)[number];

export function ContactTimeline({ contactId }: { contactId: string }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  /**
   * ODCHYLKA OD PLÁNU, KVŮLI HYDRATACI. Plán počítal zónu v serverové stránce
   * výrazem `Intl.DateTimeFormat().resolvedOptions().timeZone`. To je zóna
   * SERVERU, ne uživatele, takže oddělovače dnů by v jiné zóně padly na jiný
   * den. `useTimeZone()` bere hodnotu z `NextIntlClientProvider`, kterou
   * skořápka plní z profilu uživatele, a je stejná na serveru i v prohlížeči.
   */
  // `useTimeZone()` vrací `undefined`, dokud provider zónu nemá. Výchozí
  // hodnota je stejná jako v `packages/i18n/src/request.ts`, aby se server
  // a prohlížeč nerozešly.
  const timezone = useTimeZone() ?? 'Europe/Prague';
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ApiTimelineItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Rod kontaktu pro věty ze slotů. Vrací ho endpoint, protože klient
  // kontakt sám nečte a bez rodu by K8 skládala věty v neutrálním tvaru.
  //
  // Výčty se liší schválně a převod je tady: schéma zná `unknown`
  // (`contacts.gender` v P03), komponenta K8 zná `other`. Bez převodu by
  // `unknown` prošlo jako neplatná hodnota props a věta by se složila divně.
  const [gender, setGender] = useState<TimelineGender>('other');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const result = await fetchJson<{
          data: ApiTimelineItem[];
          contact: { gender: 'female' | 'male' | 'unknown' };
          pagination: { next_cursor: string | null; has_more: boolean };
        }>(
          timelineUrl(contactId, {
            ...(filter === 'all' ? {} : { types: filter }),
            ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
          }),
        );
        if (result.status !== 'ok') return;
        setItems((previous) =>
          nextCursor ? [...previous, ...result.data.data] : result.data.data,
        );
        setGender(result.data.contact.gender === 'unknown' ? 'other' : result.data.contact.gender);
        setCursor(result.data.pagination.next_cursor);
        setHasMore(result.data.pagination.has_more);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoaded(true);
      }
    },
    [contactId, filter],
  );

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  if (failed) {
    return (
      <div role="alert">
        <p>{t('timeline.error')}</p>
        <button
          type="button"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-2 py-1 border border-border"
          onClick={() => void load()}
        >
          {t('report.states.retry')}
        </button>
      </div>
    );
  }

  // Prázdný stav řeší obrazovka, ne komponenta: K8 props `emptyState` nemá
  // a mít nemusí, protože stav S3 patří obrazovce (registr stavů z P05).
  // Dokud se nedočetlo, prázdný stav se neukazuje: „zatím žádná aktivita"
  // u kontaktu, který ji má, je horší než chvilka čekání.
  if (!loaded) {
    return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-surface-muted" />;
  }

  if (items.length === 0) {
    return (
      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-base font-semibold">
          {t('timeline.heading')}
        </h2>
        <p>{t('timeline.empty')}</p>
        <p className="text-sm text-text-muted">{t('timeline.emptyHint')}</p>
      </section>
    );
  }

  const entries = groupWebSeries(items).map((item) => ({
    id: item.id,
    occurredAt: item.occurred_at,
    type: item.type,
    title:
      item.groupCount === undefined
        ? item.title
        : t('timeline.sessionGroup', { pages: item.groupCount }),
    icon: iconFor(item.type, item.source),
    ...(item.reliability === undefined ? {} : { reliability: item.reliability }),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
  }));

  const timelineLabels = {
    today: t('timeline.today'),
    yesterday: t('timeline.yesterday'),
    loadOlder: t('timeline.loadOlder'),
    expandCluster: (count: number) => t('timeline.expandCluster', { count }),
    collapseCluster: t('timeline.collapseCluster'),
    expanded: t('timeline.expanded'),
    collapsed: t('timeline.collapsed'),
  };

  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="text-base font-semibold">
        {t('timeline.heading')}
      </h2>
      <div role="group" aria-label={t('timeline.heading')} className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-2 py-1 border border-border"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(`timeline.filter${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
          </button>
        ))}
      </div>
      {/* Automatické stažení se označuje textem, ne jen ikonou. */}
      {entries.some((entry) => entry.reliability === 'machine') ? (
        <p className="mb-2 text-xs text-text-muted">{t('timeline.machineOpen')}</p>
      ) : null}
      <ReportTimeline
        entries={entries}
        gender={gender}
        timeZone={timezone}
        labels={timelineLabels}
        formatTime={(value) => format.dateTime(value, { timeStyle: 'short', timeZone: timezone })}
        formatDate={(value) => format.dateTime(value, { dateStyle: 'long', timeZone: timezone })}
        hasMore={hasMore}
        onLoadOlder={() => void load(cursor ?? undefined)}
      />
    </section>
  );
}
