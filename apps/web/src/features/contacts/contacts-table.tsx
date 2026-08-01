'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
// K1 z 13.1 části 6: výběr přežije přestránkování a je vidět jeho velikost, kurzorové
// stránkování bez čísel stránek, virtualizace od 100 řádků, sticky hlavička.
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ContactsBulkActions } from './bulk-actions';
import { ContactsEmptyState, ContactsFilteredEmptyState } from './contacts-empty-state';
import { ContactStatusBadges } from './status-badges';
import { describeContactState } from './contact-state';
import { useFilterChips } from './filter-chips';
import {
  contactsHref,
  hasAnyFilter,
  type ContactListFilters,
  type ContactStatus,
  type FilterNames,
} from './filters';
import { useContactsTableLabels } from './table-labels';

export type ContactRow = {
  id: string;
  email: string;
  name: string | null;
  status: ContactStatus;
  processing_restricted: boolean;
  snooze_until: string | null;
  anonymized_at: string | null;
  lists: string[];
  tags: string[];
  created_at: string;
};

export type ContactsTableProps = {
  basePath: string;
  rows: ContactRow[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  /** Z GET /api/v1/contacts/count. null znamená, že se počet nepodařilo zjistit. */
  total: { count: number; precision: 'exact' | 'estimated' } | null;
  filters: ContactListFilters;
  names: FilterNames;
  /** Kurzor z odkazu přestal platit, ukazuje se první stránka stejného filtru. */
  cursorInvalid?: boolean;
  /** Štítky projektu pro hromadné přiřazení. Prázdné pole nabídku štítků skryje. */
  tags?: { id: string; name: string }[];
};

/**
 * Výběr má dvě podoby a rozdíl mezi nimi je v 6.5 části 6 popsaný jako klasická past:
 * uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků, a smaže 50 000.
 *
 * ZNÁMÉ OMEZENÍ VŮČI P05. `DataTable` drží režim výběru („na stránce" versus „vše
 * odpovídající filtru") uvnitř `useRowSelection` a ven ho nepouští: `onSelectionChange`
 * se při rozšíření výběru na celý filtr vůbec nezavolá. Hromadné akce proto vždycky
 * dostanou režim `ids` s tím, co je opravdu zaškrtnuté. Aby rozhraní nelhalo, dialog
 * smazání počítá s týmž číslem. Až P05 přidá `onSelectionModeChange`, doplní se sem
 * druhá větev a nic dalšího se měnit nebude.
 */
export type Selection =
  { mode: 'ids'; ids: ReadonlySet<string>; count: number } | { mode: 'allMatching'; count: number };

export function ContactsTable({
  basePath,
  rows,
  pagination,
  total,
  filters,
  names,
  cursorInvalid = false,
  tags = [],
}: ContactsTableProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('selection.selectRow', { email: '' }).trim(),
    selectAllOnPage: t('selection.selectPage'),
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const describeChips = useFilterChips();

  if (rows.length === 0) {
    return hasAnyFilter(filters) ? (
      <ContactsFilteredEmptyState basePath={basePath} filters={filters} names={names} />
    ) : (
      <ContactsEmptyState basePath={basePath} />
    );
  }

  const selection: Selection = {
    mode: 'ids',
    ids: new Set(selectedIds),
    count: selectedIds.length,
  };

  const chips = describeChips(filters, names);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('list.title')}</h1>

      <DataTable
        tableId="contacts"
        caption={t('list.title')}
        rows={rows}
        getRowId={(row) => row.id}
        labels={labels}
        count={{
          value: total?.count ?? rows.length,
          precision: total?.precision ?? 'exact',
        }}
        cursorInvalid={cursorInvalid}
        filterDescription={chips.length > 0 ? format.list(chips) : ''}
        selection={{ selectedIds, onSelectionChange: setSelectedIds }}
        // Hromadné akce jsou klientská komponenta, kterou skládá tabulka, ne stránka:
        // funkci `renderBulkActions` by ze serverové komponenty nešlo předat, protože
        // přes hranici React Server Components projdou jen serializovatelné hodnoty.
        bulkActions={
          <ContactsBulkActions selection={selection} filters={filters} names={names} tags={tags} />
        }
        onRowActivate={(row) => router.push(`${basePath}/${row.id}`)}
        virtualizeFrom={100}
        // Kurzorové stránkování bez čísel stránek. Kurzor jde do URL, ne do stavu
        // komponenty: odkaz na stránku se dá poslat dál a zpětné tlačítko funguje.
        pagination={{
          hasMore: pagination.has_more && pagination.next_cursor !== null,
          canGoBack: pagination.prev_cursor !== null,
          onPrevious: () => router.push(contactsHref(basePath, filters, pagination.prev_cursor)),
          onNext: () => router.push(contactsHref(basePath, filters, pagination.next_cursor)),
        }}
        columns={[
          {
            id: 'email',
            header: t('columns.email'),
            cell: (row) => (
              <Link
                href={`${basePath}/${row.id}`}
                aria-label={t('list.openDetail', { email: row.email })}
              >
                {row.email}
              </Link>
            ),
          },
          { id: 'name', header: t('columns.name'), cell: (row) => row.name ?? '' },
          {
            id: 'status',
            header: t('columns.status'),
            cell: (row) => (
              <ContactStatusBadges
                badges={
                  describeContactState({
                    status: row.status,
                    processing_restricted: row.processing_restricted,
                    snooze_until: row.snooze_until,
                    anonymized_at: row.anonymized_at,
                    status_changed_at: row.created_at,
                    restriction_requested_at: null,
                  }).badges
                }
              />
            ),
          },
          { id: 'lists', header: t('columns.lists'), cell: (row) => format.list(row.lists) },
          { id: 'tags', header: t('columns.tags'), cell: (row) => format.list(row.tags) },
          {
            id: 'createdAt',
            header: t('columns.createdAt'),
            cell: (row) => (
              <time dateTime={row.created_at}>
                {format.dateTime(new Date(row.created_at), 'short')}
              </time>
            ),
          },
        ]}
      />
    </section>
  );
}
