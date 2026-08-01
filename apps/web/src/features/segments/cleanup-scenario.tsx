'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
  const n = (value: number) => formatCount(value, locale);

  if (step === 'freeze') {
    return (
      <section className="flex flex-col gap-2">
        <h2>{t('freeze.action')}</h2>
        <p>{t('freeze.explanation')}</p>
        <button type="button">{t('freeze.action')}</button>
      </section>
    );
  }

  if (step === 'action') {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend>{t('cleanup.title')}</legend>
        {(['unsubscribe', 'tagOnly', 'delete'] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="cleanup-action"
              checked={action === option}
              // Smazání smí jen vlastník projektu. U ostatních je volba
              // vypnutá a důvod je vidět v textu, ne až po kliknutí.
              disabled={option === 'delete' && role !== 'owner'}
              onChange={() => setAction(option)}
            />
            {t(`cleanup.${option}`)}
            <span>{t(`cleanup.${option}Hint`)}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (step === 'countdown') {
    return (
      <section className="flex flex-col gap-2">
        <p>{t('cleanup.countdown', { days, count: n(segment.count) })}</p>
        <p role="alert">{t('cleanup.warning', { days, count: n(segment.count) })}</p>
      </section>
    );
  }

  const nameMatches = typed === segment.name;

  return (
    <section className="flex flex-col gap-2">
      <h2>{t('cleanup.confirmTitle', { days, count: n(segment.count) })}</h2>
      {campaign ? (
        <p>
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

      <button type="button">{t('cleanup.download', { count: n(segment.count) })}</button>

      {/* Ochrana úrovně N4: opsat název segmentu. Zaškrtávátko „rozumím"
          člověk odklikne ze zvyku, jméno musí opsat vědomě. */}
      <label htmlFor="cleanup-confirm-name">{t('cleanup.typeName')}</label>
      <input
        id="cleanup-confirm-name"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />

      <button type="button" aria-disabled={nameMatches ? 'false' : 'true'}>
        {t('cleanup.review')}
      </button>
      <button type="button">{t('cleanup.postpone')}</button>
      <button type="button">{t('cleanup.abort')}</button>
    </section>
  );
}
