'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { DisabledReason } from '@mlain/core/reports/metrics/display';
import { Card } from '@mlain/ui/components/card';
import { MousePointerClick, Send, UserMinus } from '@mlain/ui/icons';
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

/**
 * Ikona dlaždice. Je to ozdoba, ne nositel významu: vedle ní vždycky stojí
 * popisek, takže je `aria-hidden`. Neznámý klíč dlaždice ikonu prostě nemá,
 * výčet metrik je otevřený.
 */
const TILE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  clicked: MousePointerClick,
  delivered: Send,
  unsubscribed: UserMinus,
};

export function HeadlineTiles({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const tiles = headlineTiles(payload);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[var(--spacing-gutter)]">
      {tiles.map((tile) => {
        const Icon = TILE_ICON[tile.key];
        /*
         * Hlavní dlaždice reportu je PROKLIK a pozná se to barvou ikonového
         * čtverce, ne velikostí písma. Je to jediné číslo, kterému v reportu
         * věříme bez výhrad; ostatní se dopočítávají z toho, co nám odesílací
         * služba a poštovní klienti prozradí.
         */
        const primary = tile.size === 'primary';
        return (
          <Card key={tile.key} aria-labelledby={`tile-${tile.key}`} padding="md" gap="none">
            <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
              <h3 id={`tile-${tile.key}`} className="meta-caps text-text-muted">
                {t(tile.labelKey)}
              </h3>
              {Icon === undefined ? null : (
                <span
                  aria-hidden
                  className={[
                    'inline-flex size-[var(--size-control-sm)] shrink-0 items-center justify-center',
                    'rounded-[var(--radius-control)]',
                    primary
                      ? 'bg-accent-surface text-warning-text'
                      : 'bg-surface-muted text-text-muted',
                  ].join(' ')}
                >
                  <Icon className="icon-md" />
                </span>
              )}
            </div>

            {/*
             * VYPNUTÉ MĚŘENÍ NIKDY NEVYPADÁ JAKO NULA (3.16 části 5). Dřív se
             * velké číslo vykreslovalo vždycky, takže kampaň s vypnutými prokliky
             * hlásila „0", což znamená „nikdo neklikl", tedy úplně jinou věc.
             * O tom, který ze čtyř stavů to je, rozhoduje `metricDisplay`
             * v jádře, ne tahle komponenta.
             */}
            {tile.display.kind === 'not_measured' ? (
              <p className="mt-3 text-ui text-text-muted">
                {t(NOT_MEASURED_KEY[tile.display.reason])}
              </p>
            ) : (
              <>
                {/* Číslo a slovo za ním stojí na jednom účaří, jinak se slovo
                    veze na středu čtyřicetibodové číslice. */}
                <p className="mt-3 flex flex-wrap items-baseline gap-2">
                  <span className="text-display font-semibold leading-[var(--leading-number)] tracking-[var(--tracking-number)] text-text">
                    {format.number(tile.count)}
                  </span>
                  {/* Chybějící míra je POMLČKA, ne vynechané místo: prázdno by
                      se četlo jako „procento tu být nemá", pomlčka říká
                      „spočítat ho nejde". */}
                  <span className="text-ui text-text-muted">
                    {tile.display.kind === 'dash'
                      ? '–'
                      : format.number(tile.display.rate, {
                          style: 'percent',
                          maximumFractionDigits: 1,
                        })}
                  </span>
                  <span className="text-ui text-text-muted">{t(tile.denominatorKey)}</span>
                </p>
                {/* Procento z malého vzorku se ukáže, ale s výhradou hned u něj. */}
                {tile.display.kind === 'absolute' ? (
                  <p className="mt-1 text-meta text-text-muted">{t('report.states.smallSample')}</p>
                ) : null}
              </>
            )}

            {tile.hintKey === null ? null : (
              <p className="mt-[var(--spacing-stack)] text-meta text-text-muted">
                {t(tile.hintKey)}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
