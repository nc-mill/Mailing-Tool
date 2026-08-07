'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { confirmPendingAction } from './actions';

/**
 * Okno „Potvrdit čekající" pro řádkovou nabídku seznamů.
 *
 * PROČ TU JE. Na detailu seznamu se totéž potvrzuje pruhem, který se rozbalí
 * uvnitř karty s počtem čekajících. V řádku tabulky takové místo není a obsah
 * rozbalené nabídky se při volbě položky odpojí z DOM, takže se rozbalovací tvar
 * použít nedá. Okno proto používá TYTÉŽ TEXTY z katalogu (`lists.confirmPending*`)
 * a TUTÉŽ akci `confirmPendingAction`; liší se jen nádoba, ne obsah.
 *
 * PROHLÁŠENÍ JE PODSTATA AKCE, NE OZDOBA. Server bez `declaration: true` odmítne
 * požadavek s `validation_failed` (`lists.routes.ts:872`) a je to schválně: tímhle
 * krokem se z čekajícího přihlášení stane souhlas udělený správcem a zůstane
 * v auditu. Věta o tom proto v okně stojí vždycky, ne jen v nápovědě.
 */
export function ListConfirmPendingDialog({
  workspaceId,
  list,
  open,
  onOpenChange,
  onConfirmed,
  onFailed,
}: {
  workspaceId: string;
  list: { id: string; name: string; pending_count: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kolik se jich potvrdilo a kolik se vynechalo kvůli odhlášení nebo blokaci. */
  onConfirmed: (result: { confirmed: number; skipped: number }) => void;
  onFailed: (code: string) => void;
}) {
  const t = useTranslations('contacts');
  const labels = useConfirmDialogLabels();
  const [pending, setPending] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      level="N2"
      // Změna stavu souhlasu, nic se nemaže a nic neodchází ven.
      destructive={false}
      title={t('lists.confirmPendingQuestion', { count: list.pending_count })}
      consequences={[t('lists.confirmPendingDeclaration')]}
      // Vrátit se to nedá, ale nálepka „nevratné" tu není: váhu nese prohlášení,
      // které uživatel dělá, ne slovo nad tlačítkem.
      irreversible={false}
      confirmLabel={pending ? t('lists.confirmPendingWorking') : t('lists.confirmPendingSubmit')}
      cancelLabel={t('lists.confirmPendingCancel')}
      labels={labels}
      onConfirm={async () => {
        setPending(true);
        try {
          const result = await confirmPendingAction({ workspaceId, id: list.id });
          if (result.status !== 'success') {
            onOpenChange(false);
            onFailed(result.code);
            return;
          }
          onOpenChange(false);
          onConfirmed({ confirmed: result.confirmed ?? 0, skipped: result.skipped ?? 0 });
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
