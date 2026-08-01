'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { cn } from '../../lib/cn';
import { PaginationFooter, type CountInfo } from './pagination-footer';
import { SelectionBar } from './selection-bar';
import { useColumnPreferences } from './use-column-preferences';
import { useRowSelection } from './use-row-selection';

/** Mez ze specifikace 14.2. Pod ní se virtualizace nevyplatí. */
const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 44;

export type DataTableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /**
   * Řadit jde jen podle hodnot, které zdroj vyjmenovává v `order`.
   * Sloupec mimo ten výčet řazení **vůbec nenabízí**, žádná zašedlá šipka.
   */
  sortable?: boolean;
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
  /** Nastavení sloupců: viditelnost a šířka (tvrdý požadavek K1). */
  columnSettings: string;
  columnVisible: (column: string) => string;
  columnWidth: (column: string) => string;
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
}) {
  const pageIds = rows.map(getRowId);
  const selection = useRowSelection({
    pageIds,
    selectedIds: selectionProp?.selectedIds,
    onSelectionChange: selectionProp?.onSelectionChange,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
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
    if (event.key === 'x' || event.key === ' ') {
      event.preventDefault();
      if (event.shiftKey) selection.selectRange(getRowId(row));
      else selection.toggle(getRowId(row));
      return;
    }
    if (event.key === 'Enter' && onRowActivate) {
      event.preventDefault();
      onRowActivate(row);
    }
  }

  const sortDirection = order?.value.endsWith('.desc') ? 'desc' : 'asc';
  const sortColumn = order?.value.split('.')[0];

  return (
    <div className="flex flex-col gap-3">
      {cursorInvalid ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-muted px-4 py-3 text-sm text-text"
        >
          {labels.cursorInvalid}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setColumnSettingsOpen((open) => !open)}>
          <Settings2 aria-hidden className="size-4" />
          {labels.columnSettings}
        </Button>
      </div>

      {columnSettingsOpen ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface p-4">
          {columns.map((column) => (
            <div key={column.id} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox
                  aria-label={labels.columnVisible(column.header)}
                  checked={preferences.visible.includes(column.id)}
                  onCheckedChange={() => preferences.toggleColumn(column.id)}
                />
                {column.header}
              </label>
              <input
                type="number"
                min={80}
                max={800}
                aria-label={labels.columnWidth(column.header)}
                value={preferences.widths[column.id] ?? ''}
                onChange={(event) =>
                  preferences.setWidth(column.id, Number(event.target.value) || 0)
                }
                className="min-h-11 w-24 rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm text-text"
              />
            </div>
          ))}
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
        className="overflow-auto rounded-[var(--radius-surface)] border border-border"
      >
        <div
          role="row"
          aria-rowindex={1}
          data-testid="data-table-head"
          className="sticky top-0 z-[var(--z-sticky)] flex gap-3 border-b border-border bg-surface-muted px-3 py-2"
        >
          <span role="columnheader" className="flex w-8 items-center">
            <Checkbox
              aria-label={labels.selectAllOnPage}
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
              className="flex-1 text-sm font-medium text-text"
              style={
                (preferences.widths[column.id] ?? column.width)
                  ? { width: preferences.widths[column.id] ?? column.width, flex: 'none' }
                  : undefined
              }
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
                      <ArrowUp aria-label={labels.sortedAscending} className="size-4" />
                    ) : (
                      <ArrowDown aria-label={labels.sortedDescending} className="size-4" />
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
                  'flex gap-3 border-b border-border px-3 py-2 last:border-b-0',
                  selection.isSelected(id) ? 'bg-accent-surface' : 'bg-surface',
                )}
              >
                <span role="gridcell" className="flex w-8 items-center">
                  <Checkbox
                    aria-label={labels.selectRow}
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
                    className="flex-1 text-sm text-text"
                    style={
                      (preferences.widths[column.id] ?? column.width)
                        ? { width: preferences.widths[column.id] ?? column.width, flex: 'none' }
                        : undefined
                    }
                  >
                    {column.cell(row)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

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
  );
}
