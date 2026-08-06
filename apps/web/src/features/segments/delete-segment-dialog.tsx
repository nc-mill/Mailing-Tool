'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';

/**
 * Smazání segmentu.
 *
 * PRVNÍ VĚTA JE O KONTAKTECH, A JE TO ZÁMĚR. Bez ní si lidé myslí, že mažou
 * lidi, protože v řádku vidí číslo „1 129 kontaktů" a pod ním červené „Smazat".
 * Zadavatel na to upozornil dřív, než akce vůbec vznikla.
 *
 * Zbytek vět je ověřený v kódu, ne odhadnutý:
 *
 *  - Kontakty se nemažou. `deleteSegment` (`segments/service.ts:137`) nastaví
 *    `deleted_at` na řádku segmentu a nic jiného; tabulka `contacts` se nedotkne.
 *  - U ručního segmentu zmizí i jeho soupis členů. Cizí klíč
 *    `segment_members_segment_id_segments_id_fk` je `ON DELETE CASCADE`, takže
 *    se tahle věta neslibuje u dynamického segmentu, který žádný soupis nemá.
 *  - Kampaň se segmentem v publiku ho po smazání NENAJDE. `resolveReferences`
 *    (`segments/references.ts:203`) považuje smazaný segment za neexistující
 *    odkaz, takže sestavení publika skončí chybou, ne tichým zmenšením.
 *  - Totéž platí pro segment, který si tenhle vnořil do své podmínky.
 *  - Je to MĚKKÉ smazání, ale obnova z koše v API neexistuje, takže se
 *    uživateli neslibuje. Poslední věta říká rovnou, že to vrátit nejde.
 */
export function DeleteSegmentDialog({
  segment,
  open,
  onOpenChange,
  onConfirm,
}: {
  segment: { name: string; kind: 'dynamic' | 'static' };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<{ status: 'success' } | { status: 'error'; code: string }>;
}) {
  const t = useTranslations('segments.delete');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      if (result.status === 'error') {
        setFailure(t('failed', { detail: result.code }));
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    // `destructive` znamená, že dialog nejde zavřít kliknutím mimo.
    <Dialog open={open} onOpenChange={onOpenChange} destructive>
      <DialogTitle>{t('title', { name: segment.name })}</DialogTitle>
      <DialogBody>
        <p>{t('contactsStay')}</p>
        {segment.kind === 'static' && <p className="text-text-muted">{t('membersGo')}</p>}
        <p className="text-text-muted">{t('campaignsBreak')}</p>
        <p className="text-text-muted">{t('nestedBreak')}</p>
        <p className="text-text-muted">{t('irreversible')}</p>

        {failure !== null && (
          <Alert tone="error" data-testid="delete-segment-error">
            {failure}
          </Alert>
        )}
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="destructive"
            data-testid="delete-segment-submit"
            pending={pending}
            pendingLabel={t('submitting')}
            onClick={() => void confirm()}
          >
            {t('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
