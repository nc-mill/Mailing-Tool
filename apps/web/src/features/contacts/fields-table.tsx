'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { archiveFieldAction, deleteFieldAction, loadFieldImpactAction } from './actions';
import { fieldUsage } from './field-usage';
import type { FieldImpact } from './field-impact';
import { useContactsTableLabels } from './table-labels';

export type { FieldImpact };

export type ContactFieldRow = {
  id: string;
  key: string;
  label: string;
  type: string;
  indexed: boolean;
  archived: boolean;
};

export function FieldsTable({
  workspaceId,
  fields,
  limits,
}: {
  /** Projekt pro archivaci, smazání a načtení dopadu. Bez něj API vrátí 404. */
  workspaceId: string;
  fields: ContactFieldRow[];
  limits: { fields: number; indexed: number };
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const confirmLabels = useConfirmDialogLabels();
  const labels = useContactsTableLabels({
    selectRow: t('fields.label'),
    selectAllOnPage: t('fields.title'),
  });
  const [deleting, setDeleting] = useState<{ field: ContactFieldRow; impact: FieldImpact } | null>(
    null,
  );

  const usage = fieldUsage({ fields, limits });

  async function openDelete(field: ContactFieldRow) {
    // Dopad se načítá až při otevření dialogu. Načítat ho u každého řádku dopředu
    // by znamenalo tolik dotazů, kolik je polí, a uživatel ho u většiny nikdy neuvidí.
    const result = await loadFieldImpactAction({ workspaceId, id: field.id });
    if (result.status === 'success') setDeleting({ field, impact: result.impact });
  }

  if (fields.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('fields.emptyTitle')}
        explanation={t('fields.emptyBody')}
        actions={[{ label: t('fields.emptyAction'), onClick: () => router.refresh() }]}
      />
    );
  }

  const blockedByCampaign = deleting?.impact.campaigns_scheduled[0];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('fields.title')}</h1>
      <p>{t('fields.lead')}</p>

      <p data-testid="fields-usage">
        {t('fields.usage', { used: usage.used, limit: usage.limit })}
      </p>
      <p data-testid="fields-indexed-usage">
        {t('fields.indexedUsage', { used: usage.indexedUsed, limit: usage.indexedLimit })}
      </p>
      <p className="text-sm text-text-muted">{t('fields.usageHint')}</p>

      {/* Žádné disabled na primární akci. Na stropu se ukáže, co udělat, ne mrtvé tlačítko. */}
      <div className="flex flex-col gap-2">
        <Button variant="primary">{t('fields.create')}</Button>
        {usage.atLimit ? <p>{t('fields.limitReached')}</p> : null}
        {usage.atIndexedLimit ? <p>{t('fields.indexedLimitReached')}</p> : null}
      </div>

      <DataTable
        tableId="contact-fields"
        caption={t('fields.title')}
        rows={fields}
        getRowId={(row) => row.id}
        labels={labels}
        count={{ value: fields.length, precision: 'exact' }}
        pagination={{
          hasMore: false,
          canGoBack: false,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
        columns={[
          { id: 'label', header: t('fields.label'), cell: (row) => row.label },
          { id: 'key', header: t('fields.key'), cell: (row) => row.key },
          { id: 'type', header: t('fields.type'), cell: (row) => row.type },
          {
            id: 'indexed',
            header: t('fields.indexed'),
            cell: (row) => (row.indexed ? t('lists.doubleOptInOn') : t('lists.doubleOptInOff')),
          },
          {
            id: 'action',
            header: t('columns.action'),
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await archiveFieldAction({ workspaceId, id: row.id });
                    router.refresh();
                  }}
                >
                  {t('fields.archive')}
                </Button>
                <span className="text-sm text-text-muted">{t('fields.archiveHint')}</span>
                <Button variant="destructive" onClick={() => void openDelete(row)}>
                  {t('fields.delete')}
                </Button>
              </span>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => setDeleting(open ? deleting : null)}
        level="N3"
        title={t('fields.deleteTitle', { label: deleting?.field.label ?? '' })}
        consequences={
          blockedByCampaign
            ? [t('fields.deleteBlockedByCampaign', { campaign: blockedByCampaign.name })]
            : [
                t('fields.deleteImpactContacts', {
                  count: deleting?.impact.contacts_with_value ?? 0,
                }),
                t('fields.deleteImpactTemplates', {
                  count: deleting?.impact.templates.length ?? 0,
                }),
                t('fields.deleteImpactSegments', { count: deleting?.impact.segments.length ?? 0 }),
                t('fields.deleteImpactForms', { count: deleting?.impact.forms.length ?? 0 }),
              ]
        }
        irreversible={blockedByCampaign === undefined}
        // Smazání pole drženého naplánovanou kampaní končí 409. Rozhraní ho proto
        // vůbec nenabídne: jediná dopředná akce v dialogu je archivace, a proč,
        // to říká věta ve výčtu následků.
        {...(blockedByCampaign ? {} : { acknowledgement: t('fields.deleteAck') })}
        confirmLabel={
          blockedByCampaign ? t('fields.deleteSuggestArchive') : t('fields.deleteConfirm')
        }
        cancelLabel={t('fields.deleteCancel')}
        extraAction={
          blockedByCampaign ? null : (
            <Button
              variant="secondary"
              onClick={async () => {
                if (!deleting) return;
                await archiveFieldAction({ workspaceId, id: deleting.field.id });
                setDeleting(null);
                router.refresh();
              }}
            >
              {t('fields.deleteSuggestArchive')}
            </Button>
          )
        }
        labels={confirmLabels}
        onConfirm={async () => {
          if (!deleting) return;
          if (blockedByCampaign) {
            await archiveFieldAction({ workspaceId, id: deleting.field.id });
            setDeleting(null);
            router.refresh();
            return;
          }
          const result = await deleteFieldAction({ workspaceId, id: deleting.field.id });
          if (result.status === 'success') {
            setDeleting(null);
            router.refresh();
          }
        }}
      />
    </section>
  );
}
