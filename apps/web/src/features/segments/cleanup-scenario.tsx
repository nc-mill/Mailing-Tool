'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { formatCount } from './labels';

export type CleanupStep = 'freeze' | 'action' | 'countdown' | 'confirm';

export type CleanupSegment = { name: string; count: number };

export type CleanupCampaign = {
  name: string;
  sentAt: string;
  sent: number;
  responded: number;
};

/**
 * Kroky 2, 4, 5 a 6 reaktivačního scénáře. Krok 3 (samotná kampaň) patří P13.
 *
 * Poslední krok je potvrzení TŘI DNY PŘEDEM se všemi čtyřmi čísly a třemi
 * cestami ven. Odhlášení nejde vzít zpět, takže rozhodnutí nesmí padnout
 * v okamžiku, kdy si na něj uživatel nevzpomene.
 */
export function CleanupScenario({
  step,
  segment,
  campaign,
  days = 3,
  role = 'owner',
  locale = 'cs',
}: {
  step: CleanupStep;
  segment: CleanupSegment;
  campaign?: CleanupCampaign;
  days?: number;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  locale?: string;
}) {
  const t = useTranslations('segments');
  const [typed, setTyped] = useState('');
  const [action, setAction] = useState<'unsubscribe' | 'tagOnly' | 'delete'>('unsubscribe');
  const optionId = useId();
  const n = (value: number) => formatCount(value, locale);

  if (step === 'freeze') {
    return (
      <Card>
        <CardTitle>{t('freeze.action')}</CardTitle>
        <p className="text-ui text-text-muted">{t('freeze.explanation')}</p>
        <Button variant="secondary" className="self-start">
          {t('freeze.action')}
        </Button>
      </Card>
    );
  }

  if (step === 'action') {
    return (
      <Card>
        <CardTitle>{t('cleanup.title')}</CardTitle>
        <RadioGroup
          value={action}
          onValueChange={(next) => setAction(next as typeof action)}
          className="gap-[var(--spacing-stack)]"
        >
          {(['unsubscribe', 'tagOnly', 'delete'] as const).map((option) => (
            <div key={option} className="flex items-start gap-[var(--spacing-inline)]">
              <RadioGroupItem
                id={`${optionId}-${option}`}
                value={option}
                // Smazání smí jen vlastník projektu. U ostatních je volba
                // vypnutá a důvod je vidět v textu, ne až po kliknutí.
                disabled={option === 'delete' && role !== 'owner'}
                className="mt-1.5"
              />
              <label htmlFor={`${optionId}-${option}`} className="grid gap-1">
                <span className="text-ui font-semibold text-text">{t(`cleanup.${option}`)}</span>
                <span className="text-sm text-text-muted">{t(`cleanup.${option}Hint`)}</span>
              </label>
            </div>
          ))}
        </RadioGroup>
      </Card>
    );
  }

  if (step === 'countdown') {
    return (
      <Card>
        <p className="text-ui text-text">
          {t('cleanup.countdown', { days, count: n(segment.count) })}
        </p>
        <Alert tone="warning">{t('cleanup.warning', { days, count: n(segment.count) })}</Alert>
      </Card>
    );
  }

  const nameMatches = typed === segment.name;

  return (
    <Card gap="gutter">
      <CardTitle>{t('cleanup.confirmTitle', { days, count: n(segment.count) })}</CardTitle>
      {campaign ? (
        <p className="text-ui text-text-muted">
          {t('cleanup.confirmBody', {
            campaign: campaign.name,
            sentAt: campaign.sentAt,
            sent: n(campaign.sent),
            responded: n(campaign.responded),
            count: n(segment.count),
            when: `${days} d`,
          })}
        </p>
      ) : null}

      <Button variant="secondary" className="self-start">
        {t('cleanup.download', { count: n(segment.count) })}
      </Button>

      {/* Ochrana úrovně N4: opsat název segmentu. Zaškrtávátko „rozumím"
          člověk odklikne ze zvyku, jméno musí opsat vědomě. */}
      <Field label={t('cleanup.typeName')}>
        <Input
          id="cleanup-confirm-name"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
        <Button variant="destructive" aria-disabled={nameMatches ? 'false' : 'true'}>
          {t('cleanup.review')}
        </Button>
        <Button variant="secondary">{t('cleanup.postpone')}</Button>
        <Button variant="ghost">{t('cleanup.abort')}</Button>
      </div>
    </Card>
  );
}
