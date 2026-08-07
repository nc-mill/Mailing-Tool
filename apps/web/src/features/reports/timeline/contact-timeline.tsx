'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card, CardHeader } from '@mlain/ui/components/card';
import { Alert } from '@mlain/ui/patterns/states';
import type { TimelineGender } from '@mlain/ui/patterns/timeline';
import { fetchJson, timelineUrl } from '../api-client';
import { ReportTimeline } from '../adapters/report-timeline';
import { groupWebSeries, iconFor, type ApiTimelineItem } from './group-sessions';

const FILTERS = ['all', 'email', 'web', 'contact', 'consent'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Přepínač druhu událostí. Vzhled je z návrhu detailu kontaktu: 34px vysoký
 * obdélník s hairline rámečkem a mono popiskem, vybraný je tmavý panel.
 *
 * Píše se tady, ne v `packages/ui`: je to `role="group"` s pěti tlačítky, tedy
 * totéž, co DESIGN-ZAKLAD říká o přepínači období, a na jiné obrazovce zatím
 * není. Kdyby přibyl, přestěhuje se.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center whitespace-nowrap',
        'min-h-[var(--size-control-xs)] rounded-[var(--radius-control)] px-3 py-1',
        'border border-border font-mono text-meta',
        'transition-[background-color,color] duration-[var(--duration-fast)]',
        active
          ? 'bg-panel text-panel-foreground'
          : 'bg-surface text-text-muted hover:bg-surface-muted hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * Účely souhlasu, ke kterým má katalog větu. Otevřený výčet ze serveru se do
 * `t()` posílat nesmí: neznámý účel by shodil celou osu na chybějícím klíči.
 */
const KNOWN_PURPOSES = [
  'email_marketing',
  'analytics',
  'personalization',
  'profiling',
  'third_party',
];

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

  /**
   * Druhý řádek události. Bere se ze `detail`, které vrací server, ne z ničeho
   * vymyšleného: odkaz, na který se kliklo, stránka, která se zobrazila, účel
   * souhlasu a kód chyby jsou podrobnosti, které do věty nepatří, ale bez nich
   * se řádek nedá dohledat. Když k události žádná není, druhý řádek prostě není.
   */
  function metaFor(detail: Record<string, unknown> | undefined): string | null {
    if (detail === undefined) return null;
    const parts: string[] = [];

    if (typeof detail['link_url'] === 'string') parts.push(detail['link_url']);
    const page = detail['page'];
    if (
      typeof page === 'object' &&
      page !== null &&
      typeof (page as { url?: unknown }).url === 'string'
    ) {
      parts.push((page as { url: string }).url);
    }
    const purpose = detail['purpose'];
    if (typeof purpose === 'string') {
      parts.push(KNOWN_PURPOSES.includes(purpose) ? t(`timeline.purpose.${purpose}`) : purpose);
    }
    if (typeof detail['error_code'] === 'string') parts.push(detail['error_code']);

    return parts.length === 0 ? null : parts.join(' · ');
  }

  const timelineLabels = {
    today: t('timeline.today'),
    yesterday: t('timeline.yesterday'),
    loadOlder: t('timeline.loadOlder'),
    expandCluster: (count: number) => t('timeline.expandCluster', { count }),
    collapseCluster: t('timeline.collapseCluster'),
    expanded: t('timeline.expanded'),
    collapsed: t('timeline.collapsed'),
    // Jméno trvalé kotvy pro čtečku. Do 7. 8. 2026 tam byl identifikátor
    // z databáze, který čtečka hláskovala po znacích.
    eventAnchor: ({ what, when }: { what: string; when: string }) =>
      t('timeline.eventAnchor', { what, when }),
  };

  /**
   * Obsah karty. Hlavička a filtry zůstávají vidět ve všech stavech: kdyby
   * chyba nebo prázdno vykreslily jen samotnou větu, obrazovka by se při
   * každém přepnutí filtru zavřela a uživatel by neměl kam kliknout zpátky.
   */
  function body() {
    if (failed) {
      return (
        <Alert
          tone="error"
          action={<Button onClick={() => void load()}>{t('report.states.retry')}</Button>}
        >
          {t('timeline.error')}
        </Alert>
      );
    }

    // Dokud se nedočetlo, prázdný stav se neukazuje: „zatím žádná aktivita"
    // u kontaktu, který ji má, je horší než chvilka čekání.
    if (!loaded) {
      return (
        <div
          aria-busy="true"
          className="h-64 animate-pulse rounded-[var(--radius-control)] bg-surface-muted"
        />
      );
    }

    // Prázdný stav řeší obrazovka, ne komponenta: K8 props `emptyState` nemá
    // a mít nemusí, protože stav S3 patří obrazovce (registr stavů z P05).
    if (entries.length === 0) {
      return filter === 'all' ? (
        <div className="grid gap-[var(--spacing-hairline)]">
          <p className="text-ui text-text">{t('timeline.empty')}</p>
          <p className="text-sm text-text-muted">{t('timeline.emptyHint')}</p>
        </div>
      ) : (
        // Prázdno pod filtrem není totéž co prázdná osa: kontakt aktivitu má,
        // jen ne tuhle. Věta to musí říct, jinak uživatel filtr nezruší.
        <p className="font-mono text-meta text-text-muted">{t('timeline.emptyFilter')}</p>
      );
    }

    return (
      <>
        {/* Automatické stažení se označuje textem, ne jen ikonou. */}
        {entries.some((entry) => entry.reliability === 'machine') ? (
          <p className="text-sm text-text-muted">{t('timeline.machineOpen')}</p>
        ) : null}
        <ReportTimeline
          entries={entries}
          renderMeta={(entry) => metaFor(entry.detail)}
          gender={gender}
          timeZone={timezone}
          labels={timelineLabels}
          formatTime={(value) => format.dateTime(value, { timeStyle: 'short', timeZone: timezone })}
          formatDate={(value) => format.dateTime(value, { dateStyle: 'long', timeZone: timezone })}
          hasMore={hasMore}
          onLoadOlder={() => void load(cursor ?? undefined)}
        />
      </>
    );
  }

  return (
    <Card as="section" aria-label={t('timeline.heading')} gap="gutter">
      <CardHeader
        title={t('timeline.heading')}
        action={
          <span className="font-mono text-meta text-text-muted">
            {t('timeline.count', { count: entries.length })}
          </span>
        }
      />

      <div role="group" aria-label={t('timeline.filterGroup')} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <FilterChip key={value} active={filter === value} onClick={() => setFilter(value)}>
            {t(`timeline.filter${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
          </FilterChip>
        ))}
      </div>

      {body()}
    </Card>
  );
}
