'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { deleteTagAction } from './actions';
import { useContactsTableLabels } from './table-labels';

export type TagRow = { id: string; name: string; contact_count: number };

export function TagsTable({ tags }: { tags: TagRow[] }) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const toast = useToast();
  const labels = useContactsTableLabels({
    selectRow: t('tags.name'),
    selectAllOnPage: t('tags.title'),
  });

  if (tags.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('tags.emptyTitle')}
        explanation={t('tags.emptyBody')}
        actions={[{ label: t('tags.emptyAction'), onClick: () => router.refresh() }]}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('tags.title')}</h1>
      <p>{t('tags.lead')}</p>
      <div>
        <Button variant="primary">{t('tags.create')}</Button>
      </div>

      <DataTable
        tableId="tags"
        caption={t('tags.title')}
        rows={tags}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: tags.length, precision: 'exact' }}
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          { id: 'name', header: t('tags.name'), cell: (row) => row.name },
          {
            id: 'contacts',
            header: t('columns.contact'),
            cell: (row) => t('tags.contacts', { count: row.contact_count }),
          },
          {
            id: 'action',
            header: t('columns.action'),
            cell: (row) => (
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary">{t('tags.merge')}</Button>
                {/* Smazání štítku je N1 (6.2 části 6): vratné, bez dialogu, s vrácením
                    zpět po dobu 10 s. Kontakty se nemažou, jen ztratí nálepku. */}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const result = await deleteTagAction({ id: row.id });
                    if (result.status === 'success') {
                      toast.undoable({
                        message: t('tags.deleted', { name: row.name }),
                        onUndo: () => router.refresh(),
                      });
                      router.refresh();
                    }
                  }}
                >
                  {t('tags.delete')}
                </Button>
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}
