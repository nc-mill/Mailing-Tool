'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { StatsPayload } from './report-model';

export function DiagnosticsPanel({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  return (
    <details className="rounded-lg border border-border bg-surface p-4">
      <summary>{t('report.diagnostics.heading')}</summary>
      <dl className="mt-2 text-sm">
        <dt>{t('report.diagnostics.scannerClicks')}</dt>
        <dd>{format.number(payload.counts.clicks_scanner ?? 0)}</dd>
        <dd className="text-xs text-text-muted">{t('report.diagnostics.scannerClicksHint')}</dd>
        <dt>{t('report.diagnostics.lastEvent')}</dt>
        <dd>
          {payload.last_event_at === null
            ? t('report.diagnostics.noEvents')
            : format.dateTime(new Date(payload.last_event_at), {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
        </dd>
        <dd className="text-xs text-text-muted">
          {payload.delivered_source === 'provider_events'
            ? t('report.diagnostics.deliveredSourceProvider')
            : t('report.diagnostics.deliveredSourceDerived')}
        </dd>
      </dl>
    </details>
  );
}
