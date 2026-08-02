'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon } from '@/lib/ui/status-icons';
import type { AddTrialAddressResult } from './actions';

export type TrialAddressView = { email: string; verified_at: string | null };

export type TrialView = {
  trial_mode: boolean;
  trial_mode_explicit: boolean | null;
  verified: TrialAddressView[];
  verified_count: number;
  max_addresses: number;
  has_verified_domain: boolean;
};

/** Kontrola v prohlížeči je pohodlí, rozhoduje `z.email()` na serveru. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ovládání zkušebního režimu.
 *
 * Zkušební režim je odpověď na rozpor R2: ověření domény čeká na propagaci DNS,
 * tedy minuty až hodiny, a bez něj by v testu ani v demu nešlo poslat vůbec nic.
 * Panel proto ukazuje DVĚ věci najednou, ne jen přepínač: v jakém stavu režim je
 * a na které adresy se v něm opravdu odešle. Seznam bez stavu potvrzení by lhal,
 * protože nepotvrzená adresa je pro odeslání stejně nepoužitelná jako žádná.
 */
export function TrialModePanel({
  trial,
  onToggle,
  onAddAddress,
  onRemoveAddress,
}: {
  trial: TrialView;
  onToggle?: (enabled: boolean) => Promise<{ status: 'success' | 'error'; code?: string }>;
  onAddAddress?: (email: string) => Promise<AddTrialAddressResult>;
  onRemoveAddress?: (email: string) => Promise<{ status: 'success' | 'error'; code?: string }>;
}) {
  const t = useTranslations('campaigns.trial');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; url: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const atLimit = trial.verified.length >= trial.max_addresses;

  async function toggle() {
    if (!onToggle) return;
    setToggling(true);
    try {
      const result = await onToggle(!trial.trial_mode);
      setFailure(result.status === 'error' ? t('toggleFailed') : null);
    } finally {
      setToggling(false);
    }
  }

  async function remove(email: string) {
    if (!onRemoveAddress) return;
    setRemoving(email);
    try {
      const result = await onRemoveAddress(email);
      setFailure(result.status === 'error' ? t('removeFailed') : null);
      // Hláška o odeslaném odkazu se ruší s adresou: odkaz na odebranou adresu
      // už nepotvrdí nic.
      if (result.status === 'success' && sent?.email.toLowerCase() === email.toLowerCase()) {
        setSent(null);
      }
    } finally {
      setRemoving(null);
    }
  }

  function openDialog() {
    setEmail('');
    setFieldError(null);
    setDialogOpen(true);
  }

  async function submit() {
    if (!onAddAddress) return;
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setFieldError(t('emailInvalid'));
      return;
    }
    setPending(true);
    try {
      const result = await onAddAddress(value);
      if (result.status === 'error') {
        // Strop adres se vrací jako 409 `conflict`; text stropu je konkrétnější
        // než obecné „nepodařilo se", takže se rozlišuje.
        setFieldError(
          result.code === 'conflict'
            ? t('limitReached', { max: trial.max_addresses })
            : t('addFailed'),
        );
        return;
      }
      setSent({ email: value, url: result.verificationUrl });
      setDialogOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="trial-title" className="flex flex-col gap-4" data-testid="trial-mode">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="trial-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <Badge
            tone={trial.trial_mode ? 'warning' : 'neutral'}
            icon={trial.trial_mode ? ClockIcon : CheckIcon}
          >
            {trial.trial_mode ? t('stateOn') : t('stateOff')}
          </Badge>
        </div>
        {onToggle && (
          <Button
            data-testid="trial-toggle"
            pending={toggling}
            onClick={() => void toggle()}
            variant={trial.trial_mode ? 'secondary' : 'primary'}
          >
            {trial.trial_mode
              ? trial.has_verified_domain
                ? t('disable')
                : t('turnOff')
              : t('turnOn')}
          </Button>
        )}
      </div>

      <p className="text-text-muted">{t('explanation')}</p>
      {failure && <Alert tone="error">{failure}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">{t('addressesTitle')}</h3>
        <span className="text-sm text-text-muted" data-testid="trial-address-count">
          {t('addressCount', { count: trial.verified.length, max: trial.max_addresses })}
        </span>
      </div>

      {trial.verified.length === 0 ? (
        // `EmptyState` bez akce hází, a je to správně: prázdný stav bez cesty ven
        // je slepá ulička. Bez práva zapisovat proto zbývá jen věta.
        onAddAddress ? (
          <EmptyState
            variant="first"
            title={t('addressesTitle')}
            explanation={t('addressesEmpty')}
            actions={[{ label: t('addAddress'), onClick: openDialog }]}
          />
        ) : (
          <p className="text-text-muted">{t('addressesEmpty')}</p>
        )
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="trial-address-list">
            {trial.verified.map((a) => (
              <li
                key={a.email}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border p-3"
              >
                <span className="font-mono">{a.email}</span>
                <Badge
                  tone={a.verified_at === null ? 'neutral' : 'success'}
                  icon={a.verified_at === null ? ClockIcon : CheckIcon}
                >
                  {a.verified_at === null ? t('addressPending') : t('addressVerified')}
                </Badge>
                {onRemoveAddress && (
                  <Button
                    data-testid={`trial-remove-${a.email}`}
                    pending={removing === a.email}
                    onClick={() => void remove(a.email)}
                  >
                    {t('remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {onAddAddress && (
            <div>
              {/* Tlačítko visí i mimo prázdný stav: druhou adresu přidává člověk
                  stejně často jako první, typicky kolegu, který má odeslání schválit. */}
              <Button data-testid="trial-add-address" onClick={openDialog} disabled={atLimit}>
                {t('addAddress')}
              </Button>
            </div>
          )}
        </>
      )}

      {atLimit && <Alert tone="warning">{t('limitReached', { max: trial.max_addresses })}</Alert>}

      {sent && (
        <Alert tone="success" data-testid="trial-address-sent">
          {t('sent', { email: sent.email })}
          {sent.url !== null && (
            <>
              {' '}
              <a
                href={sent.url}
                data-testid="trial-verification-link"
                className="text-accent-text underline underline-offset-4 break-all"
              >
                {t('devLink', { url: sent.url })}
              </a>
            </>
          )}
        </Alert>
      )}

      {dialogOpen && onAddAddress && (
        <Dialog open onOpenChange={setDialogOpen}>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogBody>
            <p className="text-text-muted">{t('dialogExplanation')}</p>
            <Field label={t('emailLabel')} {...(fieldError === null ? {} : { error: fieldError })}>
              <Input
                type="email"
                data-testid="trial-email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldError(null);
                }}
              />
            </Field>
          </DialogBody>
          {/* Patička má pojmenované sloty, ne `children`: který prvek je ústup
              a který potvrzení, se rozhoduje tady, ne pořadím v JSX. */}
          <DialogFooter
            retreat={<Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>}
            confirm={
              <Button
                variant="primary"
                data-testid="trial-address-submit"
                pending={pending}
                onClick={() => void submit()}
              >
                {t('submit')}
              </Button>
            }
          />
        </Dialog>
      )}
    </section>
  );
}
