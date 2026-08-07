'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { Selection } from './contacts-table';

export type BulkDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: Selection;
  /** Filtr slovy. null u výběru na stránce, protože tam žádný filtr nerozhoduje. */
  filterDescription: string | null;
  onConfirm: () => Promise<{ status: 'success' | 'error' }>;
  onExport: () => Promise<{ status: 'success' | 'error' }>;
};

type ExportState = 'idle' | 'running' | 'done' | 'failed';

/**
 * Hromadné smazání kontaktů je podle klasifikace 6.2 části 6 úroveň **N3** bez ohledu
 * na počet: dialog se souhrnem, počtem, výčtem následků a zaškrtnutím jedné konkrétní
 * věty. Opisování slova se nepoužívá, protože tření navíc tady žádnou ochranu nepřidá.
 * Silnější pojistkou je export, který data skutečně zachrání.
 *
 * ROZHODNUTÍ PROTI ZNĚNÍ ÚKOLU 61. Plán dialog skládal z primitiv, protože jeho tehdejší
 * kontrakt `ConfirmDialog` neuměl akci uvnitř dialogu. Hlavička plánu (kapitola 2, uzávěr
 * P05→P07.3) tu otevřenou otázku uzavírá ve prospěch propu: komponenta v repozitáři má
 * `exportAction` i `extraAction`, takže se skládat z primitiv nesmí.
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  selection,
  filterDescription,
  onConfirm,
  onExport,
}: BulkDeleteDialogProps) {
  const t = useTranslations('contacts');
  const labels = useConfirmDialogLabels();
  const [exportState, setExportState] = useState<ExportState>('idle');

  const count = selection.count;

  async function handleExport() {
    setExportState('running');
    const result = await onExport();
    setExportState(result.status === 'success' ? 'done' : 'failed');
  }

  const exportNote =
    exportState === 'running'
      ? t('bulk.deleteExportRunning')
      : exportState === 'done'
        ? t('bulk.deleteExportReady')
        : exportState === 'failed'
          ? t('bulk.deleteExportFailed')
          : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N3"
      destructive
      title={t('bulk.deleteTitle', { count })}
      consequences={[
        t('bulk.deleteConsequenceLists'),
        t('bulk.deleteConsequenceHistory'),
        t('bulk.deleteConsequenceReports'),
        t('bulk.deleteConsequenceSuppression'),
      ]}
      {...(filterDescription === null ? {} : { filterDescription })}
      exportAction={{
        label: t('bulk.deleteExport', { count }),
        onExport: () => void handleExport(),
      }}
      extraAction={
        exportNote === null ? null : (
          <span
            data-testid="bulk-delete-export-state"
            role={exportState === 'failed' ? 'alert' : 'status'}
            className="text-sm text-text-muted"
          >
            {exportNote}
          </span>
        )
      }
      acknowledgement={t('bulk.deleteAck')}
      confirmLabel={t('bulk.deleteConfirm', { count })}
      cancelLabel={t('bulk.cancel')}
      onConfirm={async () => {
        await onConfirm();
        onOpenChange(false);
      }}
      labels={labels}
    />
  );
}
