'use client';

import type { ReactNode } from 'react';
import {
  DataTable,
  type DataTableColumn,
  type DataTableLabels,
} from '@mlain/ui/patterns/data-table';
import type { CountInfo } from '@mlain/ui/patterns/data-table';

export type ReportTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
};

export type ReportTableProps<T> = {
  tableId: string;
  columns: ReportTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  labels: DataTableLabels;
  /** Kolik řádků filtr má. Odhad se v K1 označuje, proto `precision`. */
  count: CountInfo;
  hasMore: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onPrevious: () => void;
  /** Kurzor přestal platit: K1 ukáže první stránku a vysvětlení (kritérium 79). */
  cursorInvalid?: boolean;
  emptyState: ReactNode;
};

/**
 * Jediné místo, kde se reporty dotýkají komponenty K1.
 *
 * Stránkování je kurzorové a bez čísel stránek, což K1 vyjadřuje čtveřicí
 * `hasMore`, `canGoBack`, `onNext`, `onPrevious`. Řazení se nenabízí vůbec:
 * seznam příjemců má pevné pořadí podle kurzoru (R20) a zašedlá šipka,
 * která nic nedělá, je horší než žádná.
 */
export function ReportTable<T>(props: ReportTableProps<T>) {
  const columns: DataTableColumn<T>[] = props.columns.map((column) => ({
    id: column.key,
    header: column.header,
    cell: column.cell,
  }));

  return (
    <DataTable
      tableId={props.tableId}
      caption={props.caption}
      columns={columns}
      rows={props.rows}
      getRowId={props.rowKey}
      labels={props.labels}
      count={props.count}
      cursorInvalid={props.cursorInvalid ?? false}
      pagination={{
        hasMore: props.hasMore,
        canGoBack: props.canGoBack,
        onNext: props.onNext,
        onPrevious: props.onPrevious,
      }}
      emptyState={props.emptyState}
    />
  );
}
