'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { fetchJson, recipientsUrl } from '../api-client';
import { ReportTable } from '../adapters/report-table';
import {
  availableFilters,
  contactLabelKey,
  filterLabelKey,
  type ContactState,
  type RecipientFilter,
} from './recipients-filter';

type Recipient = {
  message_id: string;
  contact_id: string | null;
  email: string | null;
  name: string | null;
  contact_state: ContactState;
  first_open_at: string | null;
  first_click_at: string | null;
  open_count: number;
  click_count: number;
  open_reliability: 'confirmed' | 'machine' | null;
};

export function RecipientsPanel({
  campaignId,
  filter,
  onFilterChange,
  tracking,
}: {
  campaignId: string;
  filter: RecipientFilter;
  onFilterChange: (filter: RecipientFilter) => void;
  tracking: { trackOpens: boolean; trackClicks: boolean };
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [rows, setRows] = useState<Recipient[]>([]);
  // Zásobník kurzorů předchozích stránek. K1 stránkuje dopředu i zpět,
  // ale kurzorové API zpětný kurzor nevrací, takže si ho drží obrazovka.
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursorInvalid, setCursorInvalid] = useState(false);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const result = await fetchJson<{
          data: Recipient[];
          pagination: { next_cursor: string | null; has_more: boolean };
        }>(recipientsUrl(campaignId, filter, nextCursor));
        if (result.status !== 'ok') return;
        setCursorInvalid(false);
        setRows(result.data.data);
        setCursor(result.data.pagination.next_cursor);
        setHasMore(result.data.pagination.has_more);
      } catch {
        // Neplatný kurzor není chyba stránky: ukáže se první stránka téhož
        // filtru a řekne se to (kritérium 79). K1 na to má `cursorInvalid`.
        //
        // ODCHYLKA OD PLÁNU: plán tenhle případ hledal ve VĚTVI `result.status
        // !== 'ok'`. Tam se ale nikdy nedostane: `fetchJson` u chybové odpovědi
        // VYHAZUJE `ReportsApiError` a jediný jiný stav je `not_modified`.
        // Vadný kurzor by tedy shodil celý panel místo toho, aby ukázal
        // první stránku.
        if (nextCursor !== undefined) {
          setCursorInvalid(true);
          setHistory([]);
          await load();
        }
      }
    },
    [campaignId, filter],
  );

  useEffect(() => {
    setHistory([]);
    void load();
  }, [load]);

  const goNext = useCallback(() => {
    if (cursor === null) return;
    setHistory((previous) => [...previous, cursor]);
    void load(cursor);
  }, [cursor, load]);

  const goPrevious = useCallback(() => {
    setHistory((previous) => {
      const next = previous.slice(0, -1);
      void load(next[next.length - 1] ?? undefined);
      return next;
    });
  }, [load]);

  const tableLabels = {
    selectRow: t('table.selectRow'),
    selectAllOnPage: t('table.selectAllOnPage'),
    previous: t('table.previous'),
    next: t('table.next'),
    showing: (shown: number, total: number, estimated: boolean) =>
      t('table.showing', { shown, total, estimated: String(estimated) }),
    selectedOnPage: (count: number) => t('table.selectedOnPage', { count }),
    selectAllMatching: (total: number) => t('table.selectAllMatching', { total }),
    selectedAllMatching: (total: number) => t('table.selectedAllMatching', { total }),
    clearSelection: t('table.clearSelection'),
    cursorInvalid: t('table.cursorInvalid'),
    sortNotAvailable: t('table.sortNotAvailable'),
    sortedAscending: t('table.sortedAscending'),
    sortedDescending: t('table.sortedDescending'),
    columnSettings: t('table.columnSettings'),
    columnVisible: (column: string) => t('table.columnVisible', { column }),
  };

  return (
    <Card aria-labelledby="recipients-heading">
      <CardTitle>
        <span id="recipients-heading">{t('report.recipients.heading')}</span>
      </CardTitle>
      {/*
        Filtr příjemců. Vybraná položka je TMAVÝ PANEL se světlým textem: je
        jich vedle sebe až devět a jen tučnějším písmem by se vybraná ztratila.
      */}
      <div
        role="group"
        aria-label={t('report.recipients.heading')}
        className="flex flex-wrap gap-[var(--spacing-inline)]"
      >
        {availableFilters(tracking).map((value) => (
          <button
            key={value}
            type="button"
            className={[
              'min-h-[var(--size-control-sm)] px-3 text-sm',
              'rounded-[var(--radius-control)] border border-border',
              'transition-colors duration-[var(--duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              'focus-visible:outline-[var(--color-focus-ring)]',
              filter === value
                ? 'border-panel bg-panel text-panel-foreground'
                : 'bg-surface text-text-muted hover:bg-surface-muted hover:text-text',
            ].join(' ')}
            aria-pressed={filter === value}
            onClick={() => onFilterChange(value)}
          >
            {t(filterLabelKey(value))}
          </button>
        ))}
      </div>
      <ReportTable
        tableId="report-recipients"
        caption={t('report.recipients.heading')}
        rows={rows}
        rowKey={(row) => row.message_id}
        labels={tableLabels}
        // Přesný počet příjemců by znamenal COUNT(*) přes celý oddíl na každou
        // stránku. K1 umí odhad označit, takže se počítá jen to, co je na stránce.
        count={{ value: rows.length, precision: hasMore ? 'estimated' : 'exact' }}
        hasMore={hasMore}
        canGoBack={history.length > 0}
        onNext={goNext}
        onPrevious={goPrevious}
        cursorInvalid={cursorInvalid}
        emptyState={<p className="text-ui text-text-muted">{t('report.recipients.empty')}</p>}
        columns={[
          {
            key: 'contact',
            header: t('report.recipients.columnContact'),
            cell: (row) => {
              // Smazaný ani anonymizovaný kontakt nesmí panel shodit ani
              // vyrobit prázdnou buňku: `contact_id`, `email` i `name` jsou
              // u něj null (R10).
              const fallback = contactLabelKey(row.contact_state);
              if (fallback) return <span className="italic text-text-muted">{t(fallback)}</span>;
              return <span>{row.name ?? row.email ?? t('report.recipients.deletedContact')}</span>;
            },
          },
          {
            key: 'opened',
            header: t('report.recipients.columnOpened'),
            cell: (row) =>
              row.first_open_at === null ? (
                <span>{'–'}</span>
              ) : (
                <span>
                  {format.dateTime(new Date(row.first_open_at), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {row.open_reliability === 'machine' ? (
                    <span className="ml-1 text-micro text-text-muted">
                      {t('report.recipients.machineOpen')}
                    </span>
                  ) : null}
                </span>
              ),
          },
          {
            key: 'clicked',
            header: t('report.recipients.columnClicked'),
            cell: (row) =>
              row.first_click_at === null
                ? '–'
                : format.dateTime(new Date(row.first_click_at), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
          },
        ]}
      />
    </Card>
  );
}
