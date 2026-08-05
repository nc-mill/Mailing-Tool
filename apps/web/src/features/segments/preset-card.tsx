'use client';

import { Button } from '@mlain/ui/components/button';
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
    <article
      data-testid={`preset-${preset.key}`}
      className="flex h-full flex-col gap-3 rounded-[var(--radius-surface)] border border-border bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-text">{t(preset.labelKey)}</h3>
      {/* Podmínka na počet odeslaných zpráv je NA KARTĚ, ne v nápovědě: bez ní
          by do „nikdy neotevřel" spadli i lidé, kterým jsme nikdy nic neposlali,
          a to je nejčastější chyba konkurenčních nástrojů. */}
      <p className="text-sm text-text-muted">{t(preset.explanationKey)}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        {/*
         * POČÍTACÍ TLAČÍTKA JEN S OBSLUHOU.
         *
         * `onRecount` je nepovinné a seznam segmentů ho nepředává, protože počet
         * presetu se z rozhraní spočítat nedá: `GET /segments/presets` vrací jen
         * klíče popisků, ne definici, a `POST /segments/preview` chce definici
         * nebo id uloženého segmentu. Dokud jedno z toho server nedoplní, je
         * lepší tlačítko neukázat než nechat na kartě ovládací prvek, po kterém
         * se nic nestane.
         */}
        {preset.cachedCount === null ? (
          onRecount === undefined ? null : (
            <Button variant="secondary" size="sm" onClick={() => onRecount(preset.key)}>
              {t('count.action')}
            </Button>
          )
        ) : (
          <span className="text-sm font-medium text-text">
            {formatCount(preset.cachedCount, locale)}
          </span>
        )}

        {ageHours !== null ? (
          <span
            data-stale={stale ? 'true' : 'false'}
            className={stale ? 'text-xs text-text-muted opacity-70' : 'text-xs text-text-muted'}
          >
            {t('stale', { time: `${ageHours} h` })}
          </span>
        ) : null}

        {stale && onRecount !== undefined ? (
          <Button variant="ghost" size="sm" onClick={() => onRecount(preset.key)}>
            {t('recount')}
          </Button>
        ) : null}

        {/* Použití vyrobí VLASTNÍ KOPII s klíčem presetu, ne odkaz na sdílenou
            definici: jinak by úprava presetu v kódu tiše změnila segment,
            který si uživatel pojmenoval po svém. */}
        {onUse === undefined ? null : (
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            onClick={() => onUse({ preset_key: preset.key })}
          >
            {t('presets.use')}
          </Button>
        )}
      </div>
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
      <h2 className="text-base font-semibold text-text">{t('presets.sectionTitle')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
