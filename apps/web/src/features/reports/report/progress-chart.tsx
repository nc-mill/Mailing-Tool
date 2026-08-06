'use client';

import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardTitle } from '@mlain/ui/components/card';

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

/**
 * Které řady se v grafu smějí kreslit.
 *
 * TOTÉŽ PRAVIDLO JAKO U DLAŽDIC, JEN V GRAFU. Dlaždice doručenosti přestala
 * ukazovat nulu, když od odesílací služby nedorazila jediná zpráva o osudu
 * e-mailů, a začala říkat „Zatím nevíme". Graf o tom nevěděl a kreslil řadu
 * Doručeno jako plochou čáru na nule, tedy tvrdil na téže stránce opak.
 * Nezměřená řada se proto nekreslí vůbec a místo ní stojí věta proč; prázdná
 * čára na nule je horší než chybějící čára, protože vypadá jako měření.
 */
export type MeasuredSeries = { delivered: boolean; opens: boolean; clicks: boolean };

export function ProgressChart({
  points,
  granularity,
  onGranularityChange,
  compacted,
  measured,
}: {
  points: ProgressPoint[];
  granularity: '5m' | 'hour' | 'day';
  onGranularityChange: (value: '5m' | 'hour' | 'day') => void;
  compacted: boolean;
  measured: MeasuredSeries;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  const series = [
    { key: 'sent', label: t('report.chart.columnSent') },
    ...(measured.delivered ? [{ key: 'delivered', label: t('report.chart.columnDelivered') }] : []),
    ...(measured.opens ? [{ key: 'opens_unique', label: t('report.chart.columnOpens') }] : []),
    ...(measured.clicks ? [{ key: 'clicks_unique', label: t('report.chart.columnClicks') }] : []),
  ];

  const omitted = [
    measured.delivered ? null : 'report.chart.omittedDelivered',
    measured.opens ? null : 'report.chart.omittedOpens',
    measured.clicks ? null : 'report.chart.omittedClicks',
  ].filter((key): key is string => key !== null);

  return (
    <Card aria-labelledby="chart-heading">
      {/* Nadpis a přepínač měřítka na jedné lince, přepínač vpravo. */}
      <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
        <CardTitle>
          <span id="chart-heading">{t('report.chart.heading')}</span>
        </CardTitle>
        {/*
          Přepínač měřítka: jeden rámeček, uvnitř tlačítka bez rámečku. Vybrané
          měřítko je TMAVÝ PANEL se světlým textem, ne jen tučnější písmo,
          protože jinak není z odstupu poznat, které z těch tří platí.
        */}
        <div
          role="group"
          aria-label={t('report.chart.heading')}
          className="ml-auto flex overflow-hidden rounded-[var(--radius-control)] border border-border"
        >
          {(['5m', 'hour', 'day'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={[
                'min-h-[var(--size-control-sm)] px-3 text-sm',
                'transition-colors duration-[var(--duration-fast)]',
                'border-r border-border last:border-r-0',
                'focus-visible:outline-2 focus-visible:-outline-offset-2',
                'focus-visible:outline-[var(--color-focus-ring)]',
                granularity === value
                  ? 'bg-panel text-panel-foreground'
                  : 'bg-surface text-text-muted hover:bg-surface-muted hover:text-text',
              ].join(' ')}
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
      </div>
      {compacted ? (
        <p className="text-meta text-text-muted">{t('report.chart.compacted')}</p>
      ) : null}
      {/* Prázdný graf je díra v obrazovce. Dokud nedorazil ani jeden bod,
          řekne se to větou, ne prázdným místem. */}
      {points.length === 0 ? (
        <p className="text-ui text-text-muted">{t('report.diagnostics.noEvents')}</p>
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
        series={series}
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
      {omitted.map((key) => (
        <p key={key} data-testid="chart-omitted-series" className="text-meta text-text-muted">
          {t(key)}
        </p>
      ))}
    </Card>
  );
}
