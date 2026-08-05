'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { CopyButton } from '@mlain/ui/components/copy-button';

export type SecretRevealProps = {
  secret: string;
  /**
   * Klíče jsou literály, protože sekret se odhaluje u klíčů, u webhooků
   * a u hesla člena založeného správcem. Skládat je za běhu je zakázané
   * (kritérium 71 části 6), takže výčet roste s každým dalším místem.
   */
  titleKey: 'apiKeys.secret.title' | 'webhooks.secret.title' | 'members.password.title';
  warningKey: 'apiKeys.secret.warning' | 'webhooks.secret.warning' | 'members.password.warning';
  hintKey?: 'webhooks.secret.hint' | 'members.create.changeHint' | undefined;
  /**
   * Texty zaškrtnutí a zavření. Výchozí patří ke klíči k API; heslo potřebuje
   * jiná slova, protože „Sekret mám uložený" u hesla nedává smysl.
   */
  acknowledgeKey?: 'apiKeys.secret.acknowledge' | 'members.password.acknowledge' | undefined;
  closeKey?: 'apiKeys.secret.close' | 'members.password.close' | undefined;
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
  acknowledgeKey = 'apiKeys.secret.acknowledge',
  closeKey = 'apiKeys.secret.close',
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
        <span>{t(acknowledgeKey)}</span>
      </label>

      {nudge ? (
        <p role="status" className="mt-2 text-sm text-warning-text">
          {t(acknowledgeKey)}
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
          {t(closeKey)}
        </Button>
      </div>
    </section>
  );
}
