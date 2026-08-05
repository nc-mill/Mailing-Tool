'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Alert } from '@mlain/ui/patterns/states';
import type { DeleteDomainResult } from './actions';

/**
 * Odebrání odesílací domény.
 *
 * Dialog říká, CO se doopravdy stane, ne jen „opravdu?". Každá věta je ověřená
 * v kódu, ne odhadnutá:
 *
 *  - Identita u Amazonu se NERUŠÍ. `DeleteEmailIdentityCommand` se v repozitáři
 *    nikde nevolá, `deleteDomain` v jádru dělá jen SQL DELETE. Týž účet SES může
 *    patřit víc projektům, takže rušit identitu by rozbilo cizí projekt.
 *  - Odeslané kampaně zůstávají. Drží si jen `from_email`, statistiky se nemažou.
 *  - DNS záznamy u registrátora se mazat NEMAJÍ. Nic nerozbíjejí a bez nich by
 *    se doména po opětovném přidání ověřovala od začátku.
 *  - Poslední ověřená doména vrátí projekt do zkušebního režimu, protože
 *    `resolveTrialMode` počítá `trial_mode ?? !hasVerifiedDomain`.
 *
 * Výchozí doména neexistuje: `is_default` má odesílací účet, ne doména.
 */

/** Kód odpovědi na klíč hlášky. Kód `conflict` se dál rozlišuje podle `reason`. */
const ERROR_KEY: Record<string, 'conflict' | 'forbidden' | 'notFound'> = {
  conflict: 'conflict',
  forbidden: 'forbidden',
  insufficient_scope: 'forbidden',
  not_found: 'notFound',
};

export function DeleteDomainDialog({
  domain,
  lastVerified,
  open,
  onOpenChange,
  onConfirm,
}: {
  domain: { id: string; domain: string };
  /** Poslední ověřená doména projektu: odebráním se zapne zkušební režim. */
  lastVerified?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<DeleteDomainResult>;
}) {
  const t = useTranslations('campaigns.sending.deleteDomainDialog');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Odmítnutí se pojmenuje důvodem, ne kódem. `domain_has_campaigns` a
   * `domain_in_use` přijdou pod týmž kódem `conflict`, ale řeší se úplně jinak,
   * takže obecná věta „nejde to" by uživatele nechala stát na místě.
   */
  function failureText(result: Extract<DeleteDomainResult, { status: 'error' }>): string {
    if (result.reason === 'domain_in_use') return t('inUse');
    if (result.reason === 'domain_has_campaigns') {
      return t('hasCampaigns', { count: result.count ?? 1 });
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
      <DialogTitle>{t('title', { domain: domain.domain })}</DialogTitle>
      <DialogBody>
        <p>{t('explanation')}</p>
        <p className="text-text-muted">{t('sesStays')}</p>
        <p className="text-text-muted">{t('dnsStays')}</p>
        <p className="text-text-muted">{t('historyStays')}</p>
        <p className="text-text-muted">{t('runningCampaigns')}</p>

        {lastVerified === true && (
          <Alert tone="warning" data-testid="delete-domain-trial-warning">
            {t('trialWarning')}
          </Alert>
        )}

        {failure !== null && (
          <Alert tone="error" data-testid="delete-domain-error">
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
            data-testid="delete-domain-submit"
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
