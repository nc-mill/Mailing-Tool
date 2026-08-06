'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from '../../icons';
import { useId, useRef, useState } from 'react';
import { IconButton } from '../../components/icon-button';
import { Checkbox } from '../../components/checkbox';
import { cn } from '../../lib/cn';
import { PaginationFooter, type CountInfo } from './pagination-footer';
import { SelectionBar } from './selection-bar';
import { useColumnPreferences } from './use-column-preferences';
import { useRowSelection } from './use-row-selection';

/** Mez ze specifikace 14.2. Pod ní se virtualizace nevyplatí. */
const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 44;

/**
 * Ovládací prvky UVNITŘ buňky: tlačítko, odkaz, pole, zaškrtávátko, položka nabídky.
 * Kliknutí ani klávesa, které přišly z nich, řádku nepatří.
 *
 * JE TO JEDNA VĚC VE DVOU POLOVINÁCH: `onRowClick` je cesta myší, `onKeyDown` cesta
 * klávesnicí. **Kdo sáhne na jednu, musí sáhnout i na druhou.** Výčet proto stojí
 * tady, na jednom místě, a ne dvakrát opsaný uvnitř obsluh. Právě z rozejití těch
 * dvou cest vznikly obě vady, které tuhle tabulku potkaly: nejdřív fungovala jen
 * klávesnice a klik neměl obsluhu vůbec, pak měla výjimku jen myš a tlačítko v řádku
 * nešlo z klávesnice spustit.
 */
const ROW_CONTROLS = 'button, a, input, label, [role="checkbox"], [role="menuitem"]';

export type DataTableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /**
   * Řadit jde jen podle hodnot, které zdroj vyjmenovává v `order`.
   * Sloupec mimo ten výčet řazení **vůbec nenabízí**, žádná zašedlá šipka.
   */
  sortable?: boolean;
  /**
   * Pevná šířka sloupce v pixelech. Rozhoduje o ní **obrazovka**, ne uživatel:
   * je to volba návrhu pro sloupec, do kterého se sází odznak nebo datum.
   * Bez ní se sloupec roztáhne rovným dílem. Uživatelské nastavení přesné
   * šířky panel sloupců nenabízí a nikdy se neukládá.
   */
  width?: number;
};

export type DataTableLabels = {
  selectRow: string;
  selectAllOnPage: string;
  previous: string;
  next: string;
  showing: (shown: number, total: number, estimated: boolean) => string;
  selectedOnPage: (count: number) => string;
  selectAllMatching: (total: number) => string;
  selectedAllMatching: (total: number) => string;
  clearSelection: string;
  cursorInvalid: string;
  sortNotAvailable: string;
  sortedAscending: string;
  sortedDescending: string;
  /** Nastavení sloupců: viditelnost (tvrdý požadavek K1). */
  columnSettings: string;
  columnVisible: (column: string) => string;
  /**
   * Popisek křížku, kterým se panel sloupců zavírá. Nepovinný, protože ho
   * dřívější volající nemají; bez něj se křížek nevykreslí. Obrazovka, která
   * si spouštěč vzala do hlavičky, ho ale předat MÁ, jinak panel nemá jak
   * zavřít bez cesty zpátky nahoru. V katalogu je `common.actions.close`.
   */
  closeColumnSettings?: string;
};

export function DataTable<Row>({
  tableId,
  caption,
  columns,
  rows,
  getRowId,
  labels,
  count,
  pagination,
  order,
  cursorInvalid = false,
  filterDescription,
  bulkActions,
  onRowActivate,
  selection: selectionProp,
  emptyState,
  defaultVisibleColumns,
  virtualizeFrom = VIRTUALIZE_FROM,
  columnSettings,
}: {
  tableId: string;
  /** Popisek tabulky pro čtečku. Nikdy prázdný. */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  labels: DataTableLabels;
  count: CountInfo;
  pagination: {
    hasMore: boolean;
    canGoBack: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
  order?: { value: string; onChange: (value: string) => void };
  /** Kurzor přestal platit. Ukáže se první stránka stejného filtru a vysvětlení. */
  cursorInvalid?: boolean;
  filterDescription?: string;
  bulkActions?: React.ReactNode;
  onRowActivate?: (row: Row) => void;
  /** Když je zadaný, výběr drží obrazovka. Jinak si ho tabulka řídí sama. */
  selection?: { selectedIds: string[]; onSelectionChange: (next: string[]) => void };
  /** Co se ukáže místo mřížky, když nejsou žádné řádky. */
  emptyState?: React.ReactNode;
  /** Kolik sloupců je vidět, dokud si uživatel nevybere. Výchozí je 6. */
  defaultVisibleColumns?: number;
  /** Mez, od které se zapíná virtualizace. Specifikace 14.2 říká 100. */
  virtualizeFrom?: number;
  /**
   * Kdo drží otevření panelu „Nastavení sloupců".
   *
   * Bez téhle propy si ho tabulka řídí sama a vykreslí si nad sebou vlastní
   * tlačítko. To je rozumné výchozí chování pro tabulku kdekoliv v aplikaci.
   *
   * Návrh ale spouštěč nemá nad tabulkou, má ho jako **ikonový čtverec 44×44
   * v hlavičce obrazovky** vedle hlavní akce, a to shodně na Kontaktech
   * i na Seznamech. Obrazovka proto může stav převzít: předá `open`
   * a `onOpenChange`, vykreslí si `IconButton` v `PageHeader` a tabulka pak
   * **žádné vlastní tlačítko nekreslí**, jen ukáže nebo schová panel.
   */
  columnSettings?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const pageIds = rows.map(getRowId);
  const selection = useRowSelection({
    pageIds,
    selectedIds: selectionProp?.selectedIds,
    onSelectionChange: selectionProp?.onSelectionChange,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Neřízený stav existuje pořád, jen se nepoužije, když si ho vzala obrazovka.
  const [ownColumnSettingsOpen, setOwnColumnSettingsOpen] = useState(false);
  const columnSettingsOpen = columnSettings?.open ?? ownColumnSettingsOpen;
  // Předpona `id` zaškrtávátek v panelu. Na stránce může být tabulek víc,
  // takže se nesmí odvozovat jen od `column.id`.
  const columnSettingsId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Nastavení sloupců je tvrdý požadavek K1. Hook existoval od úkolu 19,
  // ale tabulka ho neimportovala, takže viditelnost ani šířka nešly měnit.
  const preferences = useColumnPreferences({
    tableId,
    allColumns: columns.map((column) => column.id),
    defaultVisible: defaultVisibleColumns ?? Math.min(columns.length, 6),
  });

  const visibleColumns = columns.filter((column) => preferences.visible.includes(column.id));

  // Virtualizace se zapíná od sta řádků (14.2). `aria-rowcount`
  // a `aria-rowindex` se počítají z dat, ne z vykreslených uzlů,
  // takže se virtualizací nemění.
  const virtualized = rows.length >= virtualizeFrom;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualized,
  });

  const visibleRows: Array<{ row: Row; index: number }> = virtualized
    ? virtualizer.getVirtualItems().flatMap((item) => {
        const row = rows[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : rows.map((row, index) => ({ row, index }));

  function focusRow(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setFocusedIndex(clamped);
    const target = bodyRef.current?.querySelectorAll<HTMLElement>('[role="row"]')[clamped];
    target?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number, row: Row) {
    // Jednopísmenné zkratky se ignorují, když je fokus v textovém poli.
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    /*
     * ENTER A MEZERNÍK PATŘÍ PRVKU V BUŇCE, NE ŘÁDKU.
     *
     * Naměřená vada, kvůli které tenhle řádek vznikl: tlačítko potvrzení v seznamu
     * kontaktů nešlo z klávesnice spustit VŮBEC. `preventDefault()` níž potlačí
     * i vlastní aktivaci tlačítka, takže Enter kontakt nepotvrdil (0 požadavků na
     * server, stav beze změny) a místo toho otevřel detail, kdežto mezerník místo
     * potvrzení přepnul výběr řádku. Myší přitom tlačítko fungovalo, protože druhá
     * polovina téhle dvojice, `onRowClick`, tutéž výjimku má. Opravila se tehdy
     * jedna cesta a do druhé se to nezrcadlilo.
     *
     * Šipky, `j`, `k` ani `x` výjimku NEMAJÍ, a je to schválně: jsou to zkratky,
     * které si žádné tlačítko neobsluhuje samo, takže se o ně řádek s nikým nepere.
     * Pohyb mezi řádky navíc musí fungovat i tehdy, když fokus stojí na tlačítku
     * uvnitř buňky, jinak by se z něj šipkami nedalo dostat pryč.
     */
    const fromRowControl = target.closest(ROW_CONTROLS) !== null;

    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      focusRow(index - 1);
      return;
    }
    if (event.key === 'x' || (event.key === ' ' && !fromRowControl)) {
      event.preventDefault();
      if (event.shiftKey) selection.selectRange(getRowId(row));
      else selection.toggle(getRowId(row));
      return;
    }
    if (event.key === 'Enter' && onRowActivate && !fromRowControl) {
      event.preventDefault();
      onRowActivate(row);
    }
  }

  /**
   * Otevření řádku myší. Doplněno dodatečně, protože tabulka reagovala VÝHRADNĚ
   * na Enter a na klik neměla handler vůbec. Klávesová cesta byla hotová
   * a odladěná, takže to nikoho nenapadlo zkusit myší, jenže drtivá většina
   * uživatelů seznam otevírá kliknutím. Týkalo se to všech seznamů v aplikaci,
   * protože tuhle tabulku používají všechny.
   *
   * Kliknutí na ovládací prvky UVNITŘ řádku se ignoruje. Bez toho by zaškrtnutí
   * políčka nebo stisk tlačítka v řádku zároveň otevřely detail, takže by výběr
   * několika položek nešel udělat vůbec.
   *
   * Druhá polovina je `onKeyDown` výš. Výčet prvků je v `ROW_CONTROLS`, ať se
   * ty dvě cesty nemají jak rozejít potřetí.
   */
  function onRowClick(event: React.MouseEvent<HTMLDivElement>, index: number, row: Row) {
    if (!onRowActivate) return;
    const target = event.target as HTMLElement;
    if (target.closest(ROW_CONTROLS)) return;
    setFocusedIndex(index);
    onRowActivate(row);
  }

  const sortDirection = order?.value.endsWith('.desc') ? 'desc' : 'asc';
  const sortColumn = order?.value.split('.')[0];

  return (
    <div className="flex flex-col gap-3">
      {cursorInvalid ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-muted px-4 py-3 text-ui text-text"
        >
          {labels.cursorInvalid}
        </p>
      ) : null}

      {columnSettings ? null : (
        <div className="flex justify-end">
          <IconButton
            variant="quiet"
            label={labels.columnSettings}
            icon={<SlidersHorizontal aria-hidden className="icon-md" />}
            onClick={() => setOwnColumnSettingsOpen((open) => !open)}
            aria-expanded={columnSettingsOpen}
          />
        </div>
      )}

      {/* Panel nastavení sloupců. Nabízí JEN skrývání a zobrazování; přesná
          šířka v pixelech se tu dřív zadávala u každého sloupce zvlášť a byla
          zrušena. Zaškrtávátka proto stojí v jedné řadě vedle sebe, ne pod
          sebou, ať je panel nízký. Zalomení je pojistka pro úzké okno, ne
          rozvržení: na běžné šířce se vejdou na jeden řádek. */}
      {columnSettingsOpen ? (
        <div className="flex items-center gap-[var(--spacing-inline)] rounded-[var(--radius-surface)] border border-border bg-surface p-[var(--spacing-stack)]">
          <div className="flex flex-1 flex-wrap items-center gap-x-[var(--spacing-gutter)]">
            {columns.map((column) => {
              const checkboxId = `${columnSettingsId}-${column.id}`;
              return (
                <div
                  key={column.id}
                  className="flex min-h-[var(--size-target-min)] items-center gap-[var(--spacing-inline)]"
                >
                  {/* `aria-label` nese celou větu („Zobrazit sloupec Jméno"),
                      viditelný popisek jen název sloupce. Spárování přes
                      `htmlFor` je tu kvůli klikací ploše: `<button>` je
                      popisovatelný prvek, takže klik na jméno sloupce
                      zaškrtávátko přepne. */}
                  <Checkbox
                    id={checkboxId}
                    aria-label={labels.columnVisible(column.header)}
                    checked={preferences.visible.includes(column.id)}
                    onCheckedChange={() => preferences.toggleColumn(column.id)}
                  />
                  <label htmlFor={checkboxId} className="text-sm text-text">
                    {column.header}
                  </label>
                </div>
              );
            })}
          </div>
          {/* Zavírací křížek. Když spouštěč drží obrazovka, je to jediná cesta,
              jak panel zavřít bez cesty zpátky do hlavičky. */}
          {labels.closeColumnSettings ? (
            <IconButton
              variant="ghost"
              size="xs"
              label={labels.closeColumnSettings}
              icon={<X aria-hidden className="icon-sm" />}
              onClick={() =>
                columnSettings
                  ? columnSettings.onOpenChange(false)
                  : setOwnColumnSettingsOpen(false)
              }
            />
          ) : null}
        </div>
      ) : null}

      <SelectionBar
        mode={selection.mode}
        count={selection.count}
        total={count.value}
        labels={labels}
        onSelectAllMatching={() =>
          selection.selectAllMatchingFilter({
            total: count.value,
            filter: filterDescription ?? '',
          })
        }
        onClear={selection.clear}
        actions={bulkActions}
      />

      {rows.length === 0 && emptyState ? emptyState : null}

      <div
        role="grid"
        hidden={rows.length === 0 && Boolean(emptyState)}
        aria-label={caption}
        // Počet řádků včetně hlavičky. Platí i při virtualizaci,
        // proto se bere z dat, ne z počtu vykreslených uzlů.
        aria-rowcount={rows.length + 1}
        data-table-id={tableId}
        className="overflow-auto rounded-[var(--radius-surface)] border border-border bg-surface"
      >
        <div
          role="row"
          aria-rowindex={1}
          data-testid="data-table-head"
          className="sticky top-0 z-[var(--z-sticky)] flex items-center gap-[var(--spacing-stack)] border-b border-border bg-surface-muted px-[var(--spacing-row-x)] py-3"
        >
          <span role="columnheader" className="flex w-8 items-center">
            <Checkbox
              aria-label={labels.selectAllOnPage}
              dense
              checked={selection.allOnPageSelected}
              onCheckedChange={() => selection.toggleAllOnPage()}
            />
          </span>
          {visibleColumns.map((column) => (
            <span
              key={column.id}
              role="columnheader"
              aria-sort={
                sortColumn === column.id
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              className="meta-caps flex-1 text-text-muted"
              style={column.width ? { width: column.width, flex: 'none' } : undefined}
            >
              {column.sortable && order ? (
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-1"
                  onClick={() =>
                    order.onChange(
                      sortColumn === column.id && sortDirection === 'asc'
                        ? `${column.id}.desc`
                        : `${column.id}.asc`,
                    )
                  }
                >
                  {column.header}
                  {sortColumn === column.id ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp aria-label={labels.sortedAscending} className="icon-sm" />
                    ) : (
                      <ArrowDown aria-label={labels.sortedDescending} className="icon-sm" />
                    )
                  ) : null}
                </button>
              ) : (
                column.header
              )}
            </span>
          ))}
        </div>

        <div
          ref={bodyRef}
          style={
            virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined
          }
        >
          {visibleRows.map(({ row, index }) => {
            const id = getRowId(row);
            return (
              <div
                key={id}
                role="row"
                // Index se počítá z dat, ne z pořadí v DOM, takže při
                // virtualizaci sedí i pro čtečku.
                aria-rowindex={index + 2}
                aria-selected={selection.isSelected(id)}
                tabIndex={index === focusedIndex ? 0 : -1}
                onKeyDown={(event) => onKeyDown(event, index, row)}
                onClick={(event) => onRowClick(event, index, row)}
                onFocus={() => setFocusedIndex(index)}
                style={
                  virtualized
                    ? {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${index * ROW_HEIGHT}px)`,
                      }
                    : undefined
                }
                className={cn(
                  'flex items-center gap-[var(--spacing-stack)] border-b border-border last:border-b-0',
                  'px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]',
                  selection.isSelected(id)
                    ? 'bg-accent-surface'
                    : 'bg-surface hover:bg-surface-muted',
                )}
              >
                <span role="gridcell" className="flex w-8 items-center">
                  <Checkbox
                    aria-label={labels.selectRow}
                    dense
                    checked={selection.isSelected(id)}
                    onClick={(event) => {
                      if (event.shiftKey) {
                        event.preventDefault();
                        selection.selectRange(id);
                      }
                    }}
                    onCheckedChange={() => selection.toggle(id)}
                  />
                </span>
                {visibleColumns.map((column) => (
                  <span
                    key={column.id}
                    role="gridcell"
                    className="min-w-0 flex-1 text-ui text-text"
                    style={column.width ? { width: column.width, flex: 'none' } : undefined}
                  >
                    {column.cell(row)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        {/* Stránkování je UVNITŘ karty, ne pod ní. V návrhu je tabulka jedna
            plocha s hairline rámečkem a patička je její spodní pruh; kdyby
            stála venku, vznikly by pod sebou dva rámečky. */}
        <PaginationFooter
          shown={rows.length}
          count={count}
          hasMore={pagination.hasMore}
          canGoBack={pagination.canGoBack}
          onPrevious={pagination.onPrevious}
          onNext={pagination.onNext}
          labels={labels}
        />
      </div>
    </div>
  );
}
