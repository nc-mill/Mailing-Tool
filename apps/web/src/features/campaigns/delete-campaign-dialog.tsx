'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';
import type { DeleteCampaignResult } from './actions';

/**
 * Smazání kampaně.
 *
 * Dialog říká, CO se doopravdy stane, ne jen „opravdu?". Každá věta je ověřená
 * v kódu, ne odhadnutá:
 *
 *  - Smazat jde JEN kampaň ve stavu `draft` nebo `schedule_missed`, tedy taková,
 *    která nikdy nikomu neodešla. Žádná odeslaná zpráva ani statistika se proto
 *    tímhle krokem smazat nemůže; jádro to hlídá podmínkou v `UPDATE`.
 *  - Je to MĚKKÉ smazání: řádek zůstává, čtení ho přeskakují. Obnova z koše ale
 *    v API neexistuje, takže se to uživateli neslibuje.
 *  - Odesílací účet a doména se od kampaně odpojí. Cizí klíč na obojí je
 *    `ON DELETE RESTRICT` a o `deleted_at` neví, takže by je kampaň v koši
 *    držela napořád a odebrat by je pak nešlo.
 *  - Šablona, ze které obsah vznikl, zůstává. Obsah je v kampani KOPIE, takže
 *    smazáním kampaně o šablonu nikdo nepřijde.
 */

/** Kód odpovědi na klíč hlášky. Kód `conflict` se dál rozlišuje podle stavu. */
const ERROR_KEY: Record<string, 'conflict' | 'forbidden' | 'notFound'> = {
  conflict: 'conflict',
  forbidden: 'forbidden',
  insufficient_scope: 'forbidden',
  not_found: 'notFound',
};

/**
 * Stav kampaně na klíč vysvětlení, proč smazat nejde.
 *
 * Rozlišují se tři případy, protože každý se řeší jinak: naplánovanou kampaň
 * stačí odplánovat a smazat půjde, u rozjeté ani u hotové to nepůjde nikdy.
 * Výčet stavů je OTEVŘENÝ, takže neznámá hodnota spadne na obecnou větu.
 */
const STATUS_KEY: Record<string, 'notDraftScheduled' | 'notDraftRunning' | 'notDraftHistory'> = {
  scheduled: 'notDraftScheduled',
  queueing: 'notDraftRunning',
  sending: 'notDraftRunning',
  paused: 'notDraftRunning',
  sent: 'notDraftHistory',
  partially_sent: 'notDraftHistory',
  cancelled: 'notDraftHistory',
  failed: 'notDraftHistory',
};

/** Sdílené s obrazovkou detailu, aby se tatáž věta nepsala dvakrát jinak. */
export function statusExplanationKey(status: string): string {
  return STATUS_KEY[status] ?? 'conflict';
}

export function DeleteCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onConfirm,
}: {
  campaign: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<DeleteCampaignResult>;
}) {
  const t = useTranslations('campaigns.delete');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Odmítnutí se pojmenuje stavem, ne kódem. Obecná věta „nejde to" nechá
   * uživatele stát na místě, přestože u naplánované kampaně stačí zrušit plán.
   */
  function failureText(result: Extract<DeleteCampaignResult, { status: 'error' }>): string {
    if (result.code === 'conflict' && result.campaignStatus !== null) {
      return t(statusExplanationKey(result.campaignStatus));
    }
    const key = ERROR_KEY[result.code];
    if (key) return t(key);
    return result.detail === '' ? t('failed') : result.detail;
  }

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      if (result.status === 'error') {
        setFailure(failureText(result));
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
      <DialogTitle>{t('title', { name: campaign.name })}</DialogTitle>
      <DialogBody>
        <p>{t('explanation')}</p>
        <p className="text-text-muted">{t('contentGoes')}</p>
        <p className="text-text-muted">{t('nothingSent')}</p>
        <p className="text-text-muted">{t('templateStays')}</p>
        <p className="text-text-muted">{t('senderReleased')}</p>

        {failure !== null && (
          <Alert tone="error" data-testid="delete-campaign-error">
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
            data-testid="delete-campaign-submit"
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
