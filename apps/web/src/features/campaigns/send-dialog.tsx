'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { toCamel, type Finding } from './readiness-checklist';

/**
 * Odeslání kampaně je nevratná akce úrovně N2: souhrn a potvrzení, bez opisování
 * a bez zaškrtávátka.
 *
 * Souhrn místo checkboxu je vědomé: uživatel má přečíst pět řádků, které mu ukážou
 * skutečný stav. Checkbox „rozumím" neověřuje nic. Výchozí fokus je na bezpečnější
 * volbě, takže Enter bez čtení nic neodešle. Opisování názvu by z ochrany udělalo
 * návyk a návyk ochranu ruší.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ KOMPONENTOU: plán skládal dialog z primitiv
 * (`Dialog`, dvě `Button`). Design systém dodal hotový `ConfirmDialog` s výchozím
 * fokusem na ústupu, blokovaným zavřením kliknutím mimo a větou o nevratnosti,
 * takže skládat ho znovu by znamenalo druhou implementaci téhož.
 */
export function SendDialog({
  open,
  onOpenChange,
  campaignName,
  recipientCount,
  fromLine,
  subject,
  undoSeconds,
  warnings,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  recipientCount: number;
  fromLine: string;
  subject: string;
  undoSeconds: number;
  warnings: Finding[];
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations('campaigns');
  const labels = useConfirmDialogLabels();

  const consequences = [
    `${t('send.recipientsLabel')}: ${t('audience.recipientCount', { count: recipientCount })}`,
    `${t('send.fromLabel')}: ${fromLine}`,
    `${t('send.subjectLabel')}: ${subject}`,
    t('send.confirmUndo', { seconds: undoSeconds }),
    ...warnings.map((w) => {
      const key = `preflight.${toCamel(w.code)}`;
      return t.has(key)
        ? `${t('send.confirmWarnings')}: ${t(key, (w.params ?? {}) as never)}`
        : `${t('send.confirmWarnings')}: ${w.code}`;
    }),
  ];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      irreversible
      title={t('send.confirmTitle', { name: campaignName })}
      consequences={consequences}
      confirmLabel={t('send.button', { count: recipientCount })}
      cancelLabel={t('send.back')}
      onConfirm={onConfirm}
      labels={labels}
    />
  );
}
