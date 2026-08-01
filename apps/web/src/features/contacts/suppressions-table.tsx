'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
// K1 z 13.1 části 6: kurzorové stránkování bez čísel stránek, výběr přežije přestránkování.
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { removeSuppressionAction, revealSuppressionEmailAction } from './actions';
import { useContactsTableLabels } from './table-labels';
import {
  bulkRemovalSummary,
  suppressionAffordance,
  type SuppressionRow,
  type WorkspaceRole,
} from './suppression-affordance';

export type SuppressionsTableProps = {
  basePath: string;
  rows: SuppressionRow[];
  role: WorkspaceRole;
  now?: Date;
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  filters: { reason?: string; q?: string };
};

function href(basePath: string, filters: { reason?: string; q?: string }, cursor: string | null) {
  const params = new URLSearchParams();
  if (filters.reason) params.set('reason', filters.reason);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}

export function SuppressionsTable({
  basePath,
  rows,
  role,
  now,
  pagination,
  filters,
}: SuppressionsTableProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();
  const labels = useContactsTableLabels({
    selectRow: t('suppressions.selectRow', { email: '' }).trim(),
    selectAllOnPage: t('suppressions.selectPage'),
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<SuppressionRow | null>(null);

  const summary = bulkRemovalSummary(rows, new Set(selectedIds), role, now);

  async function reveal(row: SuppressionRow) {
    const result = await revealSuppressionEmailAction({ id: row.id });
    if (result.status === 'success' && result.email !== undefined) {
      const email = result.email;
      setRevealed((current) => ({ ...current, [row.id]: email }));
    }
  }

  function renderAffordance(row: SuppressionRow) {
    const affordance = suppressionAffordance(row, role, now);
    if (affordance.kind === 'removable') return null;
    // Zámek s vysvětlením místo zašedlého tlačítka. Text je vidět i bez myši:
    // je v dokumentu, nikoliv jen v bublině.
    return (
      <span className="block text-sm text-text-muted">
        {affordance.explanationKey ? t(affordance.explanationKey, affordance.values) : null}
      </span>
    );
  }

  function renderAction(row: SuppressionRow) {
    const affordance = suppressionAffordance(row, role, now);
    if (affordance.kind === 'removable') {
      return (
        <Button variant="secondary" onClick={() => setRemoving(row)}>
          {t('suppressions.remove')}
        </Button>
      );
    }
    if (affordance.kind === 'waiting') {
      return <span>{t('suppressions.bounceWait', affordance.values)}</span>;
    }
    return <span aria-label={t('suppressions.locked')}>{t('suppressions.locked')}</span>;
  }

  if (rows.length === 0) {
    return filters.reason || filters.q ? (
      <FilteredEmptyState
        title={t('suppressions.filteredTitle')}
        explanation={t('suppressions.filteredBody')}
        filterDescription={filters.reason ?? filters.q ?? ''}
        clearFiltersLabel={t('suppressions.filteredClear')}
        onClearFilters={() => router.push(basePath)}
      />
    ) : (
      <EmptyState
        variant="first"
        title={t('suppressions.emptyTitle')}
        explanation={t('suppressions.emptyBody')}
        actions={[{ label: t('suppressions.emptyAction'), onClick: () => router.push(basePath) }]}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('suppressions.title')}</h1>
      <p>{t('suppressions.lead')}</p>

      <DataTable
        tableId="suppressions"
        caption={t('suppressions.title')}
        rows={rows}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: rows.length, precision: 'exact' }}
        selection={{ selectedIds, onSelectionChange: setSelectedIds }}
        virtualizeFrom={100}
        // Vybrat jde každý řádek, i ten neodebratelný. Dvě věty z 8.10.1 části 6 si jen
        // zdánlivě odporují: „hromadný výběr se u ostatních důvodů nenabízí" znamená,
        // že se u nich nenabízí hromadné ODEBRÁNÍ, ne že by je nešlo zaškrtnout.
        // Vybrat vše na stránce musí fungovat, jinak by uživatel nikdy neviděl větu
        // „28 adres odebrat nejde", která ho o matici informuje.
        bulkActions={
          <span data-testid="suppressions-bulk" className="flex flex-wrap items-center gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                // Hromadné odebrání jde jen u toho, co matice dovoluje. Zbytek se nezahrne
                // a uživatel to ví dopředu z věty pod tlačítkem, ne z chyby po kliknutí.
                for (const id of summary.removableIds) {
                  await removeSuppressionAction({ id, note: '' });
                }
                setSelectedIds([]);
                router.refresh();
              }}
            >
              {t('suppressions.bulkRemove', {
                removable: summary.removable,
                total: summary.total,
              })}
            </Button>
            {summary.blocked > 0 ? (
              <span>{t('suppressions.bulkRemoveNote', { blocked: summary.blocked })}</span>
            ) : null}
          </span>
        }
        pagination={{
          hasMore: pagination.has_more && pagination.next_cursor !== null,
          canGoBack: pagination.prev_cursor !== null,
          onPrevious: () => router.push(href(basePath, filters, pagination.prev_cursor)),
          onNext: () => router.push(href(basePath, filters, pagination.next_cursor)),
        }}
        columns={[
          {
            id: 'email',
            header: t('columns.email'),
            cell: (row) => (
              <span data-testid={`suppression-${row.id}`} className="flex flex-col gap-1">
                <span>{revealed[row.id] ?? row.masked_email}</span>
                {revealed[row.id] ? (
                  <span className="text-sm text-text-muted">{t('suppressions.revealNote')}</span>
                ) : (
                  <Button variant="link" onClick={() => void reveal(row)}>
                    {t('suppressions.reveal')}
                  </Button>
                )}
                {renderAffordance(row)}
              </span>
            ),
          },
          {
            id: 'reason',
            header: t('columns.reason'),
            cell: (row) => t(suppressionAffordance(row, role, now).reasonKey),
          },
          {
            id: 'addedAt',
            header: t('columns.addedAt'),
            cell: (row) => (
              <time dateTime={row.created_at}>
                {format.dateTime(new Date(row.created_at), 'short')}
              </time>
            ),
          },
          { id: 'action', header: t('columns.action'), cell: (row) => renderAction(row) },
        ]}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => setRemoving(open ? removing : null)}
        level="N2"
        title={t('suppressions.removeTitle', { email: removing?.masked_email ?? '' })}
        consequences={[
          t('suppressions.removeConsequenceSend'),
          t('suppressions.removeConsequenceAudit'),
        ]}
        confirmLabel={t('suppressions.removeConfirm')}
        cancelLabel={t('suppressions.removeCancel')}
        labels={confirmLabels}
        onConfirm={async () => {
          if (!removing) return;
          const result = await removeSuppressionAction({ id: removing.id, note: '' });
          if (result.status === 'success') {
            toast.success(t('suppressions.removed', { email: removing.masked_email }));
            setRemoving(null);
            router.refresh();
          }
        }}
      />
    </section>
  );
}
