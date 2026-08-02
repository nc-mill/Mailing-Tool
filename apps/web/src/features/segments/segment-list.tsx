'use client';

import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { EmptyState } from '@mlain/ui/patterns/states';
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

/** Nad šest hodin se počet nesmí tvářit čerstvě. */
const STALE_HOURS = 6;

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
  const router = useRouter();

  /**
   * Aktuální čas se čte až po připojení. Stáří počtu na něm závisí, server ho
   * nemá, a spočítané při vykreslení by vyrobilo nesoulad hydratace, který
   * React neopraví.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button variant="primary" onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}>
          {t('new')}
        </Button>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          variant="first"
          title={t('emptyTitle')}
          explanation={t('emptyList')}
          actions={[
            {
              label: t('presets.build'),
              onClick: () => router.push(`/w/${workspaceSlug}/segments/new`),
            },
          ]}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const age = now && row.cachedAt ? hoursSince(row.cachedAt, now) : null;
            const stale = age !== null && age >= STALE_HOURS;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border bg-surface p-4"
              >
                <Link
                  href={`/w/${workspaceSlug}/segments/${row.id}`}
                  className="font-medium text-accent-text underline underline-offset-4"
                >
                  {row.name}
                </Link>
                {row.kind === 'static' ? (
                  <span className="rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-xs text-text-muted">
                    {t('freeze.action')}
                  </span>
                ) : null}

                <span className="ml-auto flex flex-wrap items-center gap-3">
                  {row.cachedCount === null ? (
                    <Button variant="secondary" size="sm">
                      {t('count.action')}
                    </Button>
                  ) : (
                    <span className="text-sm font-medium text-text">
                      {formatCount(row.cachedCount, locale)}
                    </span>
                  )}

                  {age !== null ? (
                    <span
                      data-stale={stale ? 'true' : 'false'}
                      className={cn('text-sm text-text-muted', stale ? 'opacity-70' : undefined)}
                    >
                      {t('stale', { time: `${age} h` })}
                    </span>
                  ) : null}

                  {stale ? (
                    <Button variant="ghost" size="sm">
                      {t('recount')}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <PresetGrid presets={presets} locale={locale} />

      <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border bg-surface-muted p-4">
        <h2 className="text-sm font-medium text-text">{t('presets.orBuild')}</h2>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => router.push(`/w/${workspaceSlug}/segments/new`)}
        >
          {t('presets.build')}
        </Button>
      </section>
    </section>
  );
}

function cn(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
