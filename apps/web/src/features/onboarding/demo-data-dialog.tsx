'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';

export type DemoCounts = {
  contacts: number;
  lists: number;
  tags: number;
  segments: number;
  templates: number;
  campaigns: number;
};

/**
 * Odstranění ukázkových dat je podle škály rizika 6.1 části 6 úroveň **N2**:
 * rozsah nad 100 položek by dával 2 body, ale obnovitelnost je 0 (sada se dá
 * nahrát znovu jedním kliknutím) a vnější dopad 0 (na adresy example.com se
 * nikdy nic neposlalo). Součet 2 znamená potvrzovací dialog se souhrnem
 * a počty, **bez zaškrtávacího políčka a bez opisování názvu**.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KOMPONENTOU: plán volal `ConfirmDialog`
 * s propy `body` a `initialFocus`. Komponenta v `packages/ui` bere `consequences`
 * (pole konkrétních vět), `labels` a `onOpenChange`, a fokus na ústupovém
 * tlačítku si nastavuje sama. Zaškrtávací pole se u N2 nevykreslí, protože
 * si ho komponenta váže na N3, opisování na N4.
 */
export function DemoDataDialog({
  open,
  counts,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  counts: DemoCounts;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('onboarding.demo');
  const labels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      level="N2"
      title={t('dialogTitle')}
      consequences={[
        t('dialogContacts', {
          contacts: counts.contacts,
          lists: counts.lists,
          tags: counts.tags,
        }),
        t('dialogContent', {
          segments: counts.segments,
          templates: counts.templates,
          campaigns: counts.campaigns,
        }),
        t('dialogSafety'),
      ]}
      // Sada se dá nahrát znovu jedním kliknutím, takže věta o nevratnosti
      // by tady lhala a příště by ji uživatel přehlédl i tam, kde je pravdivá.
      irreversible={false}
      confirmLabel={t('dialogConfirm')}
      cancelLabel={t('dialogCancel')}
      labels={labels}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
