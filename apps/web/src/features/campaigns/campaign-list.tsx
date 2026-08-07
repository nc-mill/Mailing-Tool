'use client';

import { Fragment } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mlain/ui/components/dropdown-menu';
import { IconButton } from '@mlain/ui/components/icon-button';
import { Skeleton } from '@mlain/ui/components/skeleton';
import { DataTable, type DataTableLabels } from '@mlain/ui/patterns/data-table';
import { EmptyState, ErrorBlock } from '@mlain/ui/patterns/states';
import { MoreIcon } from '@/lib/ui/status-icons';
import { StatusBadge } from './status-badge';
import { campaignHref } from './campaign-target';
import {
  campaignRowActions,
  DESTRUCTIVE_CAMPAIGN_ACTIONS,
  type CampaignPermissions,
  type CampaignRowAction,
} from './campaign-state';

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  audience_size: number | null;
  counters: { total: number; sent: number; delivered: number; bounced: number };
  updated_at: string;
  /**
   * Pracovní obsah kampaně. Rozhoduje o položce „Upravit obsah": bez něj nemá
   * co otevřít. Odpověď `GET /campaigns` ho nese, dotahovat se nic nemusí.
   */
  template_id: string | null;
  /**
   * Proč je kampaň pozastavená. Rozhoduje o položce „Pokračovat": kampaň
   * zastavenou poskytovatelem server znovu nepustí, takže se u ní nenabízí.
   */
  pause_reason: unknown;
  /**
   * Kdy kampaň dojela. Seznam z toho skládá jen meta řádek pod nadpisem
   * („naposledy odesláno …"), takže je nepovinné: starší volající, které
   * hlavičku nevykreslují, ho posílat nemusí.
   */
  finished_at?: string | null;
};

export type CampaignListState = 'loading' | 'empty' | 'error' | 'data';

/**
 * Nabídka „…" v řádku kampaně, tvarem shodná s kontakty.
 *
 * NIC SE TU NEDĚLÁ ZNOVU. Úprava obsahu je odkaz do editoru, přejmenování drží
 * `renameCampaignAction`, duplikace `duplicateCampaignAction`, zrušení plánu
 * `unscheduleCampaignAction`, pozastavení, pokračování a zrušení rozesílky tytéž
 * akce, jaké volá obrazovka průběhu, a mazání `DeleteCampaignDialog` včetně výčtu
 * následků. Nabídka jen říká, která z nich má u téhle kampaně smysl, a spustí ji.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. Rozhodnutí dělá `campaignRowActions`
 * ve sdíleném `campaign-state.ts`, takže se táž tabulka stavů dá testovat bez
 * Reactu a ptají se jí i serverové stránky.
 *
 * Okna kreslí obrazovka, ne tahle komponenta: obsah rozbalené nabídky se při
 * volbě položky odpojí z DOM a odnesl by okno s sebou dřív, než by se ukázalo.
 *
 * Klávesu tady NIC NEZASTAVUJE, a je to tak správně. `DataTable` vyjímá cíle
 * uvnitř `ROW_CONTROLS` (tedy i `button` a `[role="menuitem"]`) z aktivace řádku
 * pro klávesnici i pro myš naráz, takže druhá pojistka v buňce by jen zakrývala,
 * kde se to řeší doopravdy.
 */
function CampaignRowMenu({
  row,
  basePath,
  permissions,
  onAction,
}: {
  row: CampaignRow;
  /** Bez cesty se nedá sestavit odkaz do editoru, takže se ta položka vynechá. */
  basePath: string | undefined;
  permissions: CampaignPermissions;
  onAction: (action: Exclude<CampaignRowAction, 'editContent'>, row: CampaignRow) => void;
}) {
  const t = useTranslations('campaigns');
  const router = useRouter();

  const actions = campaignRowActions(row, permissions).filter(
    (action) => action !== 'editContent' || basePath !== undefined,
  );

  // Kampaň, se kterou se z řádku nedá udělat nic (typicky odeslaná bez práva
  // zapisovat), nemá ani spouštěč. Prázdná nabídka je horší než žádná: slibuje
  // akce, které nemá.
  if (actions.length === 0) return null;

  /*
   * Oddělovač stojí PŘED PRVNÍ rušivou akcí, ne před každou z nich. Zrušení
   * rozesílky a smazání jsou obě červené a stojí vedle sebe, takže druhá čára
   * mezi nimi by je jen rozdrobila.
   */
  const firstDestructive = actions.findIndex((action) =>
    DESTRUCTIVE_CAMPAIGN_ACTIONS.includes(action),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="row"
          label={t('list.rowMenu', { name: row.name })}
          data-testid={`campaign-row-menu-${row.id}`}
          icon={MoreIcon}
          /*
           * ČTVEREC JE 34 PX, KLIKACÍ PLOCHA 44 PX, stejně jako u kontaktů.
           * Tlačítko o straně 44 px by řádek natáhlo a rozešlo by se s rytmem
           * ostatních tabulek; plochu proto roztahuje neviditelný překryv.
           */
          className="relative after:absolute after:top-1/2 after:left-1/2 after:size-[var(--size-target-min)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action, index) => (
          <Fragment key={action}>
            {index === firstDestructive ? <DropdownMenuSeparator /> : null}
            {/* Značka pro test se sem nedává: `DropdownMenuItem` cizí atributy
                nepropouští a položky nabídky se hledají podle jména, stejně jako
                u kontaktů. */}
            <DropdownMenuItem
              {...(DESTRUCTIVE_CAMPAIGN_ACTIONS.includes(action)
                ? ({ tone: 'danger' } as const)
                : {})}
              onSelect={() => {
                if (action === 'editContent') {
                  router.push(`${basePath}/${row.id}/content`);
                  return;
                }
                onAction(action, row);
              }}
            >
              {t(`rowActions.${action}`)}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  rowActions,
  columnSettings,
  selection,
  bulkActions,
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
   * Řádková nabídka „…". Dialogy i volání akcí patří obalu, protože seznam sám
   * o projektu ani o přihlášeném člověku nic neví; bez tohohle propu se sloupec
   * s nabídkou nevykreslí, aby v tabulce nevznikla nabídka, která nikam nevede.
   */
  rowActions?: {
    permissions: CampaignPermissions;
    onAction: (action: Exclude<CampaignRowAction, 'editContent'>, row: CampaignRow) => void;
  };
  /**
   * Výběr řádků drží obrazovka, ne tabulka.
   *
   * Bez tohohle propu si ho `DataTable` řídí sama a ven z ní nevede: zaškrtávátka
   * fungovala, ale nikdo o nich nevěděl, takže pruh nad tabulkou uměl jedině
   * vybrat všechno a výběr zase zrušit. Právě to zadavatel hlásil („Multivýběr.
   * Nemůžu s nimi nic dělat.").
   *
   * `clearToken` je jediná cesta, jak výběr uklidit i v režimu „vybráno všech N":
   * ten bydlí uvnitř tabulky a vynulování `selectedIds` ho nezruší.
   */
  selection?: {
    selectedIds: string[];
    onSelectionChange: (next: string[]) => void;
    clearToken?: unknown;
  };
  /** Hromadné akce na pruhu výběru. Bez nich pruh jen oznamuje, co je vybráno. */
  bulkActions?: React.ReactNode;
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
         * Nabídka „…" na konci řádku, tvarem shodná s kontakty. Vzniká JEN
         * tehdy, když obal dodal `rowActions`: nabídka bez napojených akcí je
         * mrtvá nabídka a v tabulce se to pozná až tím, že po volbě nic není.
         *
         * Do 6. 8. 2026 tu stála jediná ikona koše, takže se z řádku kampaně
         * nedalo udělat nic než ji smazat, a to jen u rozepsané. Duplikace,
         * zrušení plánu, pozastavení ani zrušení rozesílky odsud dostupné nebyly.
         *
         * Řádek zůstává prokliknutelný: `DataTable` vyjímá cíle uvnitř
         * `ROW_CONTROLS` z aktivace řádku pro klávesnici i pro myš, takže se
         * kampaň neotevře ani při rozbalení nabídky, ani při volbě položky.
         */
        ...(rowActions
          ? [
              {
                id: 'actions',
                // `columns.action` je týž popisek, jaký nad sloupcem s nabídkou
                // mají Kontakty, Formuláře i Vlastní pole. Nový klíč by znamenal
                // dvě slova pro jednu věc, která se má číst všude stejně.
                header: tc('table.action'),
                width: 60,
                cell: (row: CampaignRow) => (
                  <span className="flex justify-end">
                    <CampaignRowMenu
                      row={row}
                      basePath={basePath}
                      permissions={rowActions.permissions}
                      onAction={rowActions.onAction}
                    />
                  </span>
                ),
              },
            ]
          : []),
      ]}
      pagination={{ hasMore: false, canGoBack: false, onPrevious: () => {}, onNext: () => {} }}
      {...(columnSettings ? { columnSettings } : {})}
      {...(selection ? { selection } : {})}
      {...(bulkActions ? { bulkActions } : {})}
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
