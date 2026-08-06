'use client';

import {
  Bar,
  CartesianGrid,
  BarChart as RechartsBar,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame, type ChartLabels, type ChartSeries } from './chart-frame';

const SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-chart-a)',
] as const;

function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

export function BarChart({
  title,
  hideTitle,
  series,
  labels,
  formatValue,
}: {
  title: string;
  /** Skryje viditelný nadpis, přístupné jméno zůstane. Viz `ChartFrame`. */
  hideTitle?: boolean;
  series: ChartSeries[];
  labels: ChartLabels;
  formatValue?: (value: number) => string;
}) {
  const data = (series[0]?.points ?? []).map((point, index) => {
    const row: Record<string, string | number> = { x: point.x };
    for (const item of series) row[item.id] = item.points[index]?.y ?? 0;
    return row;
  });

  return (
    <ChartFrame
      title={title}
      {...(hideTitle === undefined ? {} : { hideTitle })}
      series={series}
      labels={labels}
      {...(formatValue ? { formatValue } : {})}
    >
      <ResponsiveContainer width="100%" height={280}>
        {/* Viz stejná poznámka u LineChart: rám graf schovává čtečce
            (`aria-hidden`) a skutečnou alternativu nese tabulka, takže
            Rechartsí vlastní fokusovatelná klávesová vrstva by tu porušila
            `aria-hidden-focus`. */}
        <RechartsBar data={data} accessibilityLayer={false}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="x" stroke="var(--color-text-muted)" />
          {/* Formátovač patří i na osu, ne jen do tabulky a bubliny. U měr
              osa jinak kreslí 0 až 1 a „1" vypadá jako jeden kus, ne jako
              sto procent. */}
          <YAxis
            stroke="var(--color-text-muted)"
            {...(formatValue ? { tickFormatter: formatValue } : {})}
          />
          {series.map((item, index) => (
            <Bar key={item.id} dataKey={item.id} fill={colorFor(index)} isAnimationActive={false} />
          ))}
        </RechartsBar>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
