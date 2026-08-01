'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatCount, hoursSince } from './labels';

export type PresetCardData = {
  key: string;
  /** Klíč do katalogu, ne hotový text. Preset vlastní kompilátor, texty katalog. */
  labelKey: string;
  explanationKey: string;
  cachedCount: number | null;
  cachedAt: string | null;
};

const STALE_HOURS = 6;

export function PresetCard({
  preset,
  locale = 'cs',
  onUse,
  onRecount,
}: {
  preset: PresetCardData;
  locale?: string;
  onUse?: (input: { preset_key: string }) => void;
  onRecount?: (key: string) => void;
}) {
  const t = useTranslations('segments');
  const [ageHours, setAgeHours] = useState<number | null>(null);

  // Stáří až na klientu: závisí na aktuálním čase, který server nemá.
  useEffect(() => {
    setAgeHours(preset.cachedAt === null ? null : hoursSince(preset.cachedAt, new Date()));
  }, [preset.cachedAt]);

  const stale = ageHours !== null && ageHours >= STALE_HOURS;

  return (
    <article data-testid={`preset-${preset.key}`} className="flex flex-col gap-2">
      <h3>{t(preset.labelKey)}</h3>
      {/* Podmínka na počet odeslaných zpráv je NA KARTĚ, ne v nápovědě: bez ní
          by do „nikdy neotevřel" spadli i lidé, kterým jsme nikdy nic neposlali,
          a to je nejčastější chyba konkurenčních nástrojů. */}
      <p>{t(preset.explanationKey)}</p>

      {preset.cachedCount === null ? (
        <button type="button" onClick={() => onRecount?.(preset.key)}>
          {t('count.action')}
        </button>
      ) : (
        <p>{formatCount(preset.cachedCount, locale)}</p>
      )}

      {ageHours !== null ? <p>{t('stale', { time: `${ageHours} h` })}</p> : null}
      {stale ? (
        <button type="button" onClick={() => onRecount?.(preset.key)}>
          {t('recount')}
        </button>
      ) : null}

      {/* Použití vyrobí VLASTNÍ KOPII s klíčem presetu, ne odkaz na sdílenou
          definici: jinak by úprava presetu v kódu tiše změnila segment,
          který si uživatel pojmenoval po svém. */}
      <button type="button" onClick={() => onUse?.({ preset_key: preset.key })}>
        {t('presets.use')}
      </button>
    </article>
  );
}

export function PresetGrid({
  presets,
  locale = 'cs',
  onUse,
  onRecount,
}: {
  presets: PresetCardData[];
  locale?: string;
  onUse?: (input: { preset_key: string }) => void;
  onRecount?: (key: string) => void;
}) {
  const t = useTranslations('segments');
  return (
    <section className="flex flex-col gap-3">
      <h2>{t('presets.sectionTitle')}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {presets.map((preset) => (
          <PresetCard
            key={preset.key}
            preset={preset}
            locale={locale}
            {...(onUse === undefined ? {} : { onUse })}
            {...(onRecount === undefined ? {} : { onRecount })}
          />
        ))}
      </div>
    </section>
  );
}
