'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Skeleton } from '@mlain/ui/components/skeleton';
import { Trash2 } from '@mlain/ui/icons';
import { DataTable, type DataTableLabels } from '@mlain/ui/patterns/data-table';
import { EmptyState, ErrorBlock } from '@mlain/ui/patterns/states';
import { StatusBadge } from './status-badge';
import { campaignHref } from './campaign-target';

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  audience_size: number | null;
  counters: { total: number; sent: number; delivered: number; bounced: number };
  updated_at: string;
  /**
   * Kdy kampaň dojela. Seznam z toho skládá jen meta řádek pod nadpisem
   * („naposledy odesláno …"), takže je nepovinné: starší volající, které
   * hlavičku nevykreslují, ho posílat nemusí.
   */
  finished_at?: string | null;
};

export type CampaignListState = 'loading' | 'empty' | 'error' | 'data';

/**
 * Stavy, ze kterých API kampaň smaže. TÝŽ výčet jako `DELETABLE_STATUSES`
 * v jádru: kampaň, která nikdy neodešla, se nemá čím držet.
 *
 * Není to totéž co „vede na nastavení" (`campaignTarget`): naplánovaná kampaň
 * se otevírá v nastavení, ale smazat se nedá, dokud se plán nezruší.
 *
 * V řádcích ostatních stavů se tlačítko neukazuje vůbec. Tlačítko, které vždycky
 * jen ohlásí, že to nejde, je horší než žádné; vysvětlení, proč smazat nejde,
 * patří na detail kampaně, kde je vidět celý její stav.
 */
const DELETABLE_STATUSES = new Set(['draft', 'schedule_missed']);

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
  onDelete,
  columnSettings,
}: {
  rows: CampaignRow[];
  state: CampaignListState;
  basePath?: string;
  onCreate?: () => void;
  onRetry?: () => void;
  /**
   * Stav panelu se sloupci, když si spouštěč drží hlavička obrazovky. Návrh
   * má ikonový čtverec vedle hlavní akce, ne nad tabulkou; bez tohohle propu
   * si tabulka tlačítko i stav řídí sama, jako dosud.
   */
  columnSettings?: { open: boolean; onOpenChange: (open: boolean) => void };
  /**
   * Otevře potvrzení smazání. Dialog i akce patří obalu, protože seznam sám
   * o projektu nic neví; bez téhle funkce se sloupec s mazáním nevykreslí,
   * aby v tabulce nevzniklo tlačítko, které nikam nevede.
   */
  onDelete?: (row: CampaignRow) => void;
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
    // Bez tohohle popisku by panel se sloupci neměl jak zavřít, když si
    // spouštěč drží hlavička obrazovky.
    closeColumnSettings: tc('actions.close'),
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
        {
          id: 'name',
          header: t('list.columns.name'),
          /*
           * Název je TLAČÍTKO, ne jen text. Tabulka otevírá řádek klikem
           * kamkoli, ale návrh dává názvu podtržení při najetí, tedy slib, že
           * se dá kliknout přímo na něj. Tlačítka uvnitř řádku si `DataTable`
           * schválně nevšímá, takže si cíl musí spočítat samo, a to týmž
           * `campaignHref` jako aktivace řádku.
           */
          cell: (row: CampaignRow) => (
            <button
              type="button"
              onClick={() => {
                if (basePath) router.push(campaignHref(basePath, row.id, row.status));
              }}
              className="block max-w-full truncate text-left text-ui font-semibold text-text hover:underline"
            >
              {row.name}
            </button>
          ),
        },
        {
          id: 'status',
          header: t('list.columns.status'),
          width: 150,
          cell: (row: CampaignRow) => <StatusBadge status={row.status} />,
        },
        {
          id: 'audience',
          header: t('list.columns.audience'),
          cell: (row: CampaignRow) => (
            <span className="text-sm text-text-muted">
              {t('audience.recipientCount', { count: row.audience_size ?? row.counters.total })}
            </span>
          ),
        },
        {
          id: 'sent',
          header: t('list.columns.sent'),
          width: 110,
          cell: (row: CampaignRow) => (
            <span className="font-mono text-sm text-text">{format.number(row.counters.sent)}</span>
          ),
        },
        {
          id: 'updated',
          header: t('list.columns.updated'),
          width: 130,
          // Zóna i jazyk jsou v poskytovateli, ne v dopočtu: server i klient
          // musí složit tentýž řetězec, jinak vznikne nesoulad hydratace.
          cell: (row: CampaignRow) => (
            <span className="font-mono text-meta text-text-muted">
              {format.dateTime(new Date(row.updated_at), 'short')}
            </span>
          ),
        },
        /*
         * Sloupec s mazáním vzniká JEN tehdy, když obal dodal `onDelete`.
         * Tlačítko bez napojené akce je mrtvé tlačítko a v tabulce se pozná
         * až tím, že po kliknutí nic není.
         *
         * Klik na tlačítko neotevře kampaň: `DataTable` u řádku ignoruje cíle
         * uvnitř `button`, `a`, `input` a `label`.
         */
        ...(onDelete
          ? [
              {
                id: 'delete',
                header: t('delete.columnHeader'),
                width: 110,
                cell: (row: CampaignRow) =>
                  DELETABLE_STATUSES.has(row.status) ? (
                    /*
                     * Vidět je čtverec 34 px podle návrhu, ale kliká se do
                     * 44 px: plochu roztahuje `before`, aby přístupnost
                     * nezaplatila za to, že řádek tabulky je nízký.
                     */
                    <IconButton
                      variant="ghost"
                      size="row"
                      label={t('delete.rowLabel', { name: row.name })}
                      icon={<Trash2 aria-hidden className="icon-sm" />}
                      data-testid={`delete-campaign-${row.id}`}
                      onClick={() => onDelete(row)}
                      className={[
                        'relative text-danger-text hover:border-danger hover:text-danger-text',
                        "before:absolute before:left-1/2 before:top-1/2 before:content-['']",
                        'before:size-[var(--size-target-min)]',
                        'before:-translate-x-1/2 before:-translate-y-1/2',
                      ].join(' ')}
                    />
                  ) : null,
              },
            ]
          : []),
      ]}
      pagination={{ hasMore: false, canGoBack: false, onPrevious: () => {}, onNext: () => {} }}
      {...(columnSettings ? { columnSettings } : {})}
      {...(basePath
        ? {
            /*
             * Kam řádek vede, rozhoduje `campaignHref` podle stavu, ne tahle
             * komponenta: totéž rozhodnutí dělá i serverová stránka, když
             * přesměrovává ručně napsanou adresu. Dvě kopie pravidla by se
             * dřív nebo později rozešly.
             */
            onRowActivate: (row: CampaignRow) =>
              router.push(campaignHref(basePath, row.id, row.status)),
          }
        : {})}
    />
  );
}
