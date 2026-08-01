'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { CopyButton } from '@mlain/ui/components/copy-button';

export type SecretRevealProps = {
  secret: string;
  /** Klíče jsou literály, protože sekret se odhaluje u klíčů i u webhooků. */
  titleKey: 'apiKeys.secret.title' | 'webhooks.secret.title';
  warningKey: 'apiKeys.secret.warning' | 'webhooks.secret.warning';
  hintKey?: 'webhooks.secret.hint' | undefined;
  onClose: () => void;
};

/**
 * Sekret se ukazuje právě jednou, hned po vytvoření. Zavření je za
 * zaškrtnutím, aby ho nikdo nezavřel omylem. Tlačítko přitom **nemá**
 * `disabled` (kritérium 18 kapitoly 15.2 části 6): místo mrtvého tlačítka
 * se ukáže věta, co se čeká.
 */
export function SecretReveal({
  secret,
  titleKey,
  warningKey,
  hintKey,
  onClose,
}: SecretRevealProps) {
  const t = useTranslations('settings');
  const [acknowledged, setAcknowledged] = useState(false);
  const [nudge, setNudge] = useState(false);

  return (
    <section role="alert" className="rounded-lg border border-warning bg-surface p-6">
      <h3 className="text-lg font-semibold">{t(titleKey)}</h3>
      <p className="mt-2 font-medium text-warning-text">{t(warningKey)}</p>
      {hintKey ? <p className="mt-2 text-sm text-text-muted">{t(hintKey)}</p> : null}

      <div className="mt-4 flex items-center gap-2 rounded-md bg-surface-muted p-3">
        <code className="break-all">{secret}</code>
        <CopyButton value={secret} label={t('shared.copy')} copiedLabel={t('shared.copied')} />
      </div>

      <label className="mt-4 flex items-center gap-2">
        <Checkbox
          checked={acknowledged}
          // Radix předává `boolean | 'indeterminate'`. Zúžení na `boolean`
          // není pod `strictFunctionTypes` přiřaditelné a typová kontrola spadne.
          onCheckedChange={(state: boolean | 'indeterminate') => {
            const value = state === true;
            setAcknowledged(value);
            if (value) setNudge(false);
          }}
        />
        <span>{t('apiKeys.secret.acknowledge')}</span>
      </label>

      {nudge ? (
        <p role="status" className="mt-2 text-sm text-warning-text">
          {t('apiKeys.secret.acknowledge')}
        </p>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            if (acknowledged) onClose();
            else setNudge(true);
          }}
        >
          {t('apiKeys.secret.close')}
        </Button>
      </div>
    </section>
  );
}
