'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';
import type { ActionResult } from './actions';

/**
 * Zrušení zbytku rozesílky.
 *
 * PROČ VŮBEC DIALOG. Pozastavení i pokračování jsou vratné a v nabídce se spouští
 * rovnou. Zrušení vratné NENÍ: `cancelled` je v tabulce přechodů koncový stav
 * (`packages/core/src/campaigns/state-machine.ts:22`), takže se zrušená kampaň
 * nedá znovu rozjet ani pozastavením naopak. Kdo chce zbytku napsat, musí udělat
 * duplikát, což je jiná kampaň s vlastním identifikátorem.
 *
 * Dialog říká následek ČÍSLEM, ne jen slovem „opravdu?". Kolik lidí zprávu už
 * dostalo a kolika už nepřijde, je jediný údaj, podle kterého se dá rozhodnout,
 * a seznam ho má po ruce v `counters`.
 */
export function CancelCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onConfirm,
}: {
  campaign: {
    name: string;
    /** Kolik zpráv už odešlo. Z `counters.sent` v odpovědi seznamu. */
    sent: number;
    /** Kolik jich mělo odejít celkem. `null` znamená, že se publikum nezná. */
    total: number | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<ActionResult>;
}) {
  const t = useTranslations('campaigns.cancelDialog');
  const format = useFormatter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /*
   * Zbytek se dopočítá, ne odhadne. Když publikum není známé, věta o zbytku se
   * VYNECHÁ celá: „zbývá 0" by u běžící kampaně bylo tvrzení, které není pravda.
   * Záporná hodnota vzniknout nemůže, ale `Math.max` ji odřízne pro případ, kdy
   * se čítač a velikost publika na okamžik rozejdou.
   */
  const remaining = campaign.total === null ? null : Math.max(campaign.total - campaign.sent, 0);

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      if (result.status === 'error') {
        setFailure(result.code);
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
        {remaining === null ? null : (
          <p className="text-text-muted" data-testid="cancel-campaign-numbers">
            {t('numbers', {
              sent: format.number(campaign.sent),
              remaining: format.number(remaining),
            })}
          </p>
        )}
        <p className="text-text-muted">{t('sentStays')}</p>
        <p className="text-text-muted">{t('irreversible')}</p>

        {failure !== null && (
          <Alert tone="error" data-testid="cancel-campaign-error">
            {t('failed', { detail: failure })}
          </Alert>
        )}
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('back')}
          </Button>
        }
        confirm={
          <Button
            variant="destructive"
            data-testid="cancel-campaign-submit"
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
