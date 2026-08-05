'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { DisabledReason } from '@mlain/core/reports/metrics/display';
import { headlineTiles, type StatsPayload } from './report-model';

/**
 * Jediné místo, kde se z důvodu „tohle číslo nemáme" stává text. Klíče jsou
 * tři, protože „nemá se z čeho počítat" u otevření, u prokliků a u doručení
 * není totéž. U prvních dvou měření vypnul správce a zapne si ho zpátky,
 * u doručení nám odesílací služba zatím nic neřekla a řeší se dokončením
 * nastavení oznámení.
 */
const NOT_MEASURED_KEY: Record<DisabledReason, string> = {
  opens_disabled: 'report.states.trackingOffOpens',
  clicks_disabled: 'report.states.trackingOffClicks',
  delivery_unknown: 'report.states.deliveryUnknown',
};

export function HeadlineTiles({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const tiles = headlineTiles(payload);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((tile) => (
        <section
          key={tile.key}
          aria-labelledby={`tile-${tile.key}`}
          className={
            tile.size === 'primary'
              ? 'rounded-lg border border-border bg-surface p-6 sm:col-span-1'
              : 'rounded-lg border border-border bg-surface p-4'
          }
        >
          <h3 id={`tile-${tile.key}`} className="text-sm text-text-muted">
            {t(tile.labelKey)}
          </h3>

          {/*
           * VYPNUTÉ MĚŘENÍ NIKDY NEVYPADÁ JAKO NULA (3.16 části 5). Dřív se
           * velké číslo vykreslovalo vždycky, takže kampaň s vypnutými prokliky
           * hlásila „0", což znamená „nikdo neklikl", tedy úplně jinou věc.
           * O tom, který ze čtyř stavů to je, rozhoduje `metricDisplay`
           * v jádře, ne tahle komponenta.
           */}
          {tile.display.kind === 'not_measured' ? (
            <p className="text-sm text-text-muted">{t(NOT_MEASURED_KEY[tile.display.reason])}</p>
          ) : (
            <>
              <p
                className={
                  tile.size === 'primary' ? 'text-5xl font-semibold' : 'text-3xl font-semibold'
                }
              >
                {format.number(tile.count)}
              </p>
              {tile.display.kind === 'dash' ? (
                <p className="text-sm text-text-muted">{'–'}</p>
              ) : (
                <p className="text-sm">
                  {format.number(tile.display.rate, {
                    style: 'percent',
                    maximumFractionDigits: 1,
                  })}
                </p>
              )}
              {/* Procento z malého vzorku se ukáže, ale s výhradou hned u něj. */}
              {tile.display.kind === 'absolute' ? (
                <p className="text-xs text-text-muted">{t('report.states.smallSample')}</p>
              ) : null}
              <p className="text-xs text-text-muted">{t(tile.denominatorKey)}</p>
            </>
          )}

          {tile.hintKey === null ? null : (
            <p className="mt-2 text-xs text-text-muted">{t(tile.hintKey)}</p>
          )}
        </section>
      ))}
    </div>
  );
}
