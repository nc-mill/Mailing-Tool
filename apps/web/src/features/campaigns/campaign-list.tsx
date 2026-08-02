'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Skeleton } from '@mlain/ui/components/skeleton';
import { DataTable, type DataTableLabels } from '@mlain/ui/patterns/data-table';
import { EmptyState, ErrorBlock } from '@mlain/ui/patterns/states';
import { StatusBadge } from './status-badge';

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  audience_size: number | null;
  counters: { total: number; sent: number; delivered: number; bounced: number };
  updated_at: string;
};

export type CampaignListState = 'loading' | 'empty' | 'error' | 'data';

/**
 * Čtyři stavy obrazovky (S1, S3, S4 a data). Prázdný stav vysvětluje pojem a nabízí
 * akci, stav načítání ukazuje kostru řádků místo kolečka a chybový stav nabízí
 * zopakování, ne jen hlášku.
 */
export function CampaignList({
  rows,
  state,
  basePath,
  onCreate,
  onRetry,
}: {
  rows: CampaignRow[];
  state: CampaignListState;
  basePath?: string;
  onCreate?: () => void;
  onRetry?: () => void;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2" data-testid="campaign-list-loading">
        {/* `Skeleton` z design systému bere jen `className`, atributy nepropouští,
            takže značka pro test patří na obal, ne na něj. */}
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} data-testid="skeleton-row">
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <ErrorBlock
        title={t('list.loadError')}
        reason={t('list.loadErrorReason')}
        problem={{ code: 'internal_error', requestId: '-', occurredAt: new Date(0) }}
        {...(onRetry ? { onRetry } : {})}
        labels={{
          technicalDetails: tc('errors.technicalDetails'),
          code: tc('errors.code'),
          requestId: tc('errors.requestId'),
          time: tc('errors.time'),
          copyBlock: tc('actions.copy'),
          copied: tc('actions.copied'),
          tryAgain: t('list.retry'),
        }}
      />
    );
  }

  if (state === 'empty') {
    return (
      <EmptyState
        variant="first"
        title={t('list.empty')}
        explanation={t('list.emptyExplanation')}
        actions={[{ label: t('list.emptyAction'), onClick: () => onCreate?.() }]}
      />
    );
  }

  const labels: DataTableLabels = {
    selectRow: tc('table.selectRow'),
    selectAllOnPage: tc('table.selectAllOnPage'),
    previous: tc('table.previous'),
    next: tc('table.next'),
    showing: (shown, total, estimated) =>
      estimated
        ? tc('table.showingOfEstimate', {
            shown: format.number(shown),
            total: format.number(total),
          })
        : tc('table.showingOfExact', { shown: format.number(shown), total: format.number(total) }),
    selectedOnPage: (count) => tc('table.selectedOnPage', { count }),
    selectAllMatching: (total) => tc('table.selectAllMatching', { total }),
    selectedAllMatching: (total) => tc('table.selectedAllMatching', { total }),
    clearSelection: tc('table.clearSelection'),
    cursorInvalid: tc('table.cursorInvalid'),
    sortNotAvailable: tc('table.sortNotAvailable'),
    sortedAscending: tc('a11y.sortedAscending'),
    sortedDescending: tc('a11y.sortedDescending'),
    columnSettings: tc('table.columns'),
    columnVisible: (column) => `${tc('table.columns')}: ${column}`,
    columnWidth: (column) => `${tc('table.columns')}: ${column}`,
  };

  return (
    <DataTable
      tableId="campaigns"
      caption={t('list.title')}
      rows={rows}
      getRowId={(row: CampaignRow) => row.id}
      labels={labels}
      count={{ value: rows.length, precision: 'exact' }}
      columns={[
        { id: 'name', header: t('list.columns.name'), cell: (row: CampaignRow) => row.name },
        {
          id: 'status',
          header: t('list.columns.status'),
          cell: (row: CampaignRow) => <StatusBadge status={row.status} />,
        },
        {
          id: 'audience',
          header: t('list.columns.audience'),
          cell: (row: CampaignRow) =>
            t('audience.recipientCount', { count: row.audience_size ?? row.counters.total }),
        },
        {
          id: 'sent',
          header: t('list.columns.sent'),
          cell: (row: CampaignRow) => format.number(row.counters.sent),
        },
        {
          id: 'updated',
          header: t('list.columns.updated'),
          // Zóna i jazyk jsou v poskytovateli, ne v dopočtu: server i klient
          // musí složit tentýž řetězec, jinak vznikne nesoulad hydratace.
          cell: (row: CampaignRow) => format.dateTime(new Date(row.updated_at), 'short'),
        },
      ]}
      pagination={{ hasMore: false, canGoBack: false, onPrevious: () => {}, onNext: () => {} }}
      {...(basePath
        ? { onRowActivate: (row: CampaignRow) => router.push(`${basePath}/${row.id}/progress`) }
        : {})}
    />
  );
}
