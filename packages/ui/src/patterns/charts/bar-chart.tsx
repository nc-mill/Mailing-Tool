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
] as const;

function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

export function BarChart({
  title,
  series,
  labels,
  formatValue,
}: {
  title: string;
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
      series={series}
      labels={labels}
      {...(formatValue ? { formatValue } : {})}
    >
      <ResponsiveContainer width="100%" height={280}>
        <RechartsBar data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="x" stroke="var(--color-text-muted)" />
          <YAxis stroke="var(--color-text-muted)" />
          {series.map((item, index) => (
            <Bar key={item.id} dataKey={item.id} fill={colorFor(index)} isAnimationActive={false} />
          ))}
        </RechartsBar>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
