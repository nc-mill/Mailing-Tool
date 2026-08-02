'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { headlineTiles, type StatsPayload } from './report-model';

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
          <p
            className={
              tile.size === 'primary' ? 'text-5xl font-semibold' : 'text-3xl font-semibold'
            }
          >
            {format.number(tile.count)}
          </p>
          {tile.rate === null ? (
            <p className="text-sm text-text-muted">{'–'}</p>
          ) : (
            <p className="text-sm">
              {format.number(tile.rate, { style: 'percent', maximumFractionDigits: 1 })}
            </p>
          )}
          <p className="text-xs text-text-muted">{t(tile.denominatorKey)}</p>
          {tile.hintKey === null ? null : (
            <p className="mt-2 text-xs text-text-muted">{t(tile.hintKey)}</p>
          )}
        </section>
      ))}
    </div>
  );
}
