'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';

export type RemoveTagDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Počet označených kontaktů. Patří do nadpisu, ne jen do lišty nad tabulkou. */
  count: number;
  tagName: string;
  onConfirm: () => Promise<void>;
};

/**
 * Potvrzení hromadného odebrání štítku, úroveň **N2**: nadpis s počtem a názvem štítku,
 * výčet následků, potvrdit a ustoupit.
 *
 * PROČ DIALOG, KDYŽ PŘIDÁNÍ ŠTÍTKU ŽÁDNÝ NEMÁ. Přidání se hlásí oznámením s nabídkou
 * „Vrátit zpět" a je to správně: vrácení je přesný opak, tedy odebrat týmž kontaktům
 * týž štítek. U odebrání to NEPLATÍ. Vrácení by štítek přidalo VŠEM označeným, tedy
 * i těm, kteří ho nikdy neměli, protože rozsah akce je výběr, ne seznam kontaktů,
 * kterých se změna doopravdy dotkla. Tlačítko „Vrátit zpět" by tedy slibovalo návrat
 * do původního stavu, který neumí. Krok navíc patří PŘED akci, ne po ní.
 *
 * `irreversible` je vypnuté: štítek ani kontakty nikam nemizí, nevratná je jen ta jedna
 * vazba, a to říká poslední odrážka vlastními slovy.
 */
export function RemoveTagDialog({
  open,
  onOpenChange,
  count,
  tagName,
  onConfirm,
}: RemoveTagDialogProps) {
  const t = useTranslations('contacts');
  const labels = useConfirmDialogLabels();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      // Štítek zůstává, jen se sundá z vybraných kontaktů a jde přidat zpátky.
      destructive={false}
      title={t('bulk.removeTagTitle', { count, tag: tagName })}
      consequences={[
        t('bulk.removeTagConsequenceScope'),
        t('bulk.removeTagConsequenceTagStays'),
        t('bulk.removeTagConsequenceBack'),
      ]}
      irreversible={false}
      confirmLabel={t('bulk.removeTag')}
      cancelLabel={t('bulk.cancel')}
      onConfirm={async () => {
        await onConfirm();
        onOpenChange(false);
      }}
      labels={labels}
    />
  );
}
