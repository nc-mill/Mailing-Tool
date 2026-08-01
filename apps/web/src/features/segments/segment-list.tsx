'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatCount, hoursSince } from './labels';
import { PresetGrid, type PresetCardData } from './preset-card';

export type SegmentListRow = {
  id: string;
  name: string;
  kind: 'dynamic' | 'static';
  cachedCount: number | null;
  cachedAt: string | null;
};

/** Seznam segmentů a karty presetů. Stáří počtu se počítá až na klientu. */
export function SegmentList({
  rows,
  presets,
  workspaceSlug,
  locale = 'cs',
}: {
  rows: SegmentListRow[];
  presets: PresetCardData[];
  workspaceSlug: string;
  locale?: string;
}) {
  const t = useTranslations('segments');
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  return (
    <div className="flex flex-col gap-6">
      <h1>{t('title')}</h1>

      {rows.length === 0 ? (
        <p>{t('emptyList')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const age = now && row.cachedAt ? hoursSince(row.cachedAt, now) : null;
            return (
              <li key={row.id} className="flex items-center gap-3">
                <a href={`/w/${workspaceSlug}/segments/${row.id}`}>{row.name}</a>
                {row.cachedCount === null ? (
                  <button type="button">{t('count.action')}</button>
                ) : (
                  <span>{formatCount(row.cachedCount, locale)}</span>
                )}
                {age !== null ? (
                  <span data-stale={age >= 6 ? 'true' : 'false'}>
                    {t('stale', { time: `${age} h` })}
                  </span>
                ) : null}
                {age !== null && age >= 6 ? <button type="button">{t('recount')}</button> : null}
              </li>
            );
          })}
        </ul>
      )}

      <PresetGrid presets={presets} locale={locale} />

      <section>
        <h2>{t('presets.orBuild')}</h2>
        <a href={`/w/${workspaceSlug}/segments/new`}>{t('presets.build')}</a>
      </section>
    </div>
  );
}
