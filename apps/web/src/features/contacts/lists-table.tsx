'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmptyState } from '@mlain/ui/patterns/states';
import { ClockIcon } from '@/lib/ui/status-icons';
import { useContactsTableLabels } from './table-labels';

export type ListRow = {
  id: string;
  name: string;
  confirmed_count: number;
  pending_count: number;
  double_opt_in: boolean;
  archived: boolean;
};

export function ListsTable({ basePath, lists }: { basePath: string; lists: ListRow[] }) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const labels = useContactsTableLabels({
    selectRow: t('lists.name'),
    selectAllOnPage: t('lists.title'),
  });

  if (lists.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('lists.emptyTitle')}
        explanation={t('lists.emptyBody')}
        // Prázdný stav nabízel „Načíst znovu", což nic nezakládá. Prvním krokem
        // v projektu bez seznamu je seznam založit.
        actions={[{ label: t('lists.create'), onClick: () => router.push(`${basePath}/new`) }]}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('lists.title')}</h1>
      <p>{t('lists.lead')}</p>
      {/* Tlačítko do 5. 8. 2026 NEMĚLO ŽÁDNOU AKCI, takže seznam nešlo z rozhraní
          založit vůbec. Teď vede na `/lists/new`. */}
      <div>
        <Button variant="primary" onClick={() => router.push(`${basePath}/new`)}>
          {t('lists.create')}
        </Button>
      </div>

      <DataTable
        tableId="lists"
        caption={t('lists.title')}
        rows={lists}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: lists.length, precision: 'exact' }}
        onRowActivate={(row) => router.push(`${basePath}/${row.id}`)}
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          {
            id: 'name',
            header: t('lists.name'),
            cell: (row) => (
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/${row.id}`}
                  aria-label={t('lists.openDetail', { name: row.name })}
                >
                  {row.name}
                </Link>
                {row.archived ? (
                  <Badge tone="neutral" icon={ClockIcon}>
                    {t('lists.archived')}
                  </Badge>
                ) : null}
              </span>
            ),
          },
          {
            id: 'members',
            header: t('columns.contact'),
            // Dvě čísla vedle sebe, obě celou větou. Potvrzení i čekající nesou
            // rozhodnutí: podle prvního se posílá, podle druhého se pozná zaseknutý
            // potvrzovací e-mail.
            cell: (row) => (
              <span className="flex flex-col">
                <span>{t('lists.members', { count: row.confirmed_count })}</span>
                <span>{t('lists.pending', { count: row.pending_count })}</span>
              </span>
            ),
          },
          {
            id: 'doubleOptIn',
            header: t('lists.doubleOptIn'),
            cell: (row) =>
              row.double_opt_in ? t('lists.doubleOptInOn') : t('lists.doubleOptInOff'),
          },
        ]}
      />
    </section>
  );
}
