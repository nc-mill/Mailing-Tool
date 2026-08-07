'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';

/**
 * Smazání VÍC kampaní naráz.
 *
 * Věty o následku jsou tytéž jako u jedné kampaně (`campaigns.delete.*`), protože
 * se nemění tím, kolik kampaní se maže: obsah je pryč, šablona zůstává, odesílací
 * účet se odpojí. Nové znění má jen to, co je na hromadném mazání jiné, tedy počet
 * a přeskočené kampaně.
 *
 * NEJDŮLEŽITĚJŠÍ VĚTA JE O PŘESKOČENÝCH. Výběr může obsahovat kampaně v libovolném
 * stavu, ale smazat jde jen `draft` a `schedule_missed`. Bez téhle věty by uživatel
 * označil dvanáct kampaní, pět by jich zmizelo a nikdo by mu neřekl proč. Tichý
 * částečný úspěch je horší než odmítnutí celé akce.
 */
export function BulkDeleteCampaignsDialog({
  open,
  onOpenChange,
  deletable,
  skipped,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kolik označených kampaní se doopravdy smaže. */
  deletable: number;
  /** Kolik jich ve výběru zůstane, protože je jádro smazat nenechá. */
  skipped: number;
  /** Vrací počet kampaní, které se smazat nepodařily, nebo chybu k vypsání. */
  onConfirm: () => Promise<{ failed: number; detail: string | null }>;
}) {
  const t = useTranslations('campaigns');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      // Okno zůstává otevřené, dokud se něco nepovedlo: uživatel se tak dozví,
      // kolik kampaní zůstalo, aniž by hlášku přebilo překreslení seznamu.
      if (result.failed > 0) {
        setFailure(
          result.detail === null
            ? t('bulk.deleteFailed', { count: result.failed })
            : t('bulk.deleteFailedDetail', { count: result.failed, detail: result.detail }),
        );
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
      <DialogTitle>{t('bulk.deleteTitle', { count: deletable })}</DialogTitle>
      <DialogBody>
        <p>{t('delete.explanation')}</p>
        <p className="text-text-muted">{t('delete.contentGoes')}</p>
        <p className="text-text-muted">{t('delete.nothingSent')}</p>
        <p className="text-text-muted">{t('delete.templateStays')}</p>
        <p className="text-text-muted">{t('delete.senderReleased')}</p>

        {/* Přeskočené kampaně nejsou chyba, jen důsledek stavu, proto tón `info`
            a ne `error`. Vidět ale být musí: je to jediné místo, kde se uživatel
            dozví, proč se z dvanácti označených smaže pět. */}
        {skipped > 0 && (
          <Alert tone="info" data-testid="bulk-delete-campaigns-skipped">
            {t('bulk.deleteSkipped', { count: skipped })}
          </Alert>
        )}

        {failure !== null && (
          <Alert tone="error" data-testid="bulk-delete-campaigns-error">
            {failure}
          </Alert>
        )}
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('delete.cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="destructive"
            data-testid="bulk-delete-campaigns-submit"
            pending={pending}
            pendingLabel={t('delete.submitting')}
            onClick={() => void confirm()}
          >
            {t('bulk.deleteSubmit', { count: deletable })}
          </Button>
        }
      />
    </Dialog>
  );
}
