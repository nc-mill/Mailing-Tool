'use client';

import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { ArrowRight } from '@mlain/ui/icons';
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
    <Card
      as="article"
      padding="md"
      gap="none"
      data-testid={`preset-${preset.key}`}
      className="h-full gap-3"
    >
      <h3 className="text-body font-semibold tracking-[var(--tracking-heading)] text-text">
        {t(preset.labelKey)}
      </h3>
      {/* Podmínka na počet odeslaných zpráv je NA KARTĚ, ne v nápovědě: bez ní
          by do „nikdy neotevřel" spadli i lidé, kterým jsme nikdy nic neposlali,
          a to je nejčastější chyba konkurenčních nástrojů. */}
      <p className="text-sm text-text-muted">{t(preset.explanationKey)}</p>

      <div className="mt-auto flex flex-wrap items-center gap-[var(--spacing-inline)] pt-2">
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
          <span className="font-mono text-ui text-text">
            {formatCount(preset.cachedCount, locale)}
          </span>
        )}

        {ageHours !== null ? (
          <span
            data-stale={stale ? 'true' : 'false'}
            className={
              stale
                ? 'font-mono text-label text-text-muted opacity-70'
                : 'font-mono text-label text-text-muted'
            }
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
          <Button variant="secondary" size="sm" onClick={() => onUse({ preset_key: preset.key })}>
            <ArrowRight aria-hidden className="icon-sm" />
            {t('presets.use')}
          </Button>
        )}
      </div>
    </Card>
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
    <section className="grid min-w-0 gap-[var(--spacing-gutter)]">
      <div className="flex flex-wrap items-baseline gap-[var(--spacing-stack)]">
        <h2 className="text-h2 font-semibold tracking-[var(--tracking-heading)] text-text">
          {t('presets.sectionTitle')}
        </h2>
        <span className="font-mono text-meta text-text-muted">{t('presets.editableHint')}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[var(--spacing-gutter)]">
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
