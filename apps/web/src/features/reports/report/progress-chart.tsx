'use client';

import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';

/**
 * Graf není součástí základního balíku, viz kritérium 82 části 6.
 *
 * Líné hranice jsou dvě a obě mají důvod: `@mlain/ui/patterns/charts/lazy`
 * drží mimo balík `recharts`, tenhle `dynamic` drží mimo balík i adaptér.
 */
const ReportChart = dynamic(() => import('../adapters/report-chart').then((m) => m.ReportChart), {
  ssr: false,
});

export type ProgressPoint = {
  at: string;
  sent: number;
  delivered: number;
  opens_unique: number;
  clicks_unique: number;
};

export function ProgressChart({
  points,
  granularity,
  onGranularityChange,
  compacted,
}: {
  points: ProgressPoint[];
  granularity: '5m' | 'hour' | 'day';
  onGranularityChange: (value: '5m' | 'hour' | 'day') => void;
  compacted: boolean;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  return (
    <section
      aria-labelledby="chart-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="chart-heading" className="text-base font-semibold">
        {t('report.chart.heading')}
      </h2>
      <div role="group" aria-label={t('report.chart.heading')} className="mb-2 flex gap-2">
        {(['5m', 'hour', 'day'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-2 py-1 border border-border"
            aria-pressed={granularity === value}
            onClick={() => onGranularityChange(value)}
          >
            {t(
              value === '5m'
                ? 'report.chart.granularity5m'
                : value === 'hour'
                  ? 'report.chart.granularityHour'
                  : 'report.chart.granularityDay',
            )}
          </button>
        ))}
      </div>
      {compacted ? <p className="text-xs text-text-muted">{t('report.chart.compacted')}</p> : null}
      {/* Prázdný graf je díra v obrazovce. Dokud nedorazil ani jeden bod,
          řekne se to větou, ne prázdným místem. */}
      {points.length === 0 ? (
        <p className="text-sm text-text-muted">{t('report.diagnostics.noEvents')}</p>
      ) : null}
      <ReportChart
        title={t('report.chart.heading')}
        labels={{
          showTable: t('chart.showTable'),
          hideTable: t('chart.hideTable'),
          tableCaption: t('report.chart.tableCaption'),
          periodColumn: t('report.chart.columnTime'),
        }}
        formatValue={(value) => format.number(value)}
        formatPeriod={(iso) =>
          format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' })
        }
        series={[
          { key: 'sent', label: t('report.chart.columnSent') },
          { key: 'delivered', label: t('report.chart.columnDelivered') },
          { key: 'opens_unique', label: t('report.chart.columnOpens') },
          { key: 'clicks_unique', label: t('report.chart.columnClicks') },
        ]}
        points={points.map((point) => ({
          at: point.at,
          values: {
            sent: point.sent,
            delivered: point.delivered,
            opens_unique: point.opens_unique,
            clicks_unique: point.clicks_unique,
          },
        }))}
      />
    </section>
  );
}
