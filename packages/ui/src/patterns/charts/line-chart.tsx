'use client';

import {
  CartesianGrid,
  Line,
  LineChart as RechartsLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartFrame, type ChartLabels, type ChartSeries } from './chart-frame';

// Prázdný řetězec u „solid" znamená plnou čáru bez přerušení, `strokeDasharray`
// typ `string | number` explicitní `undefined` nepřijímá.
const STROKE_PATTERNS: Record<string, string> = {
  solid: '',
  dashed: '6 4',
  dotted: '2 3',
  dashDot: '8 3 2 3',
};

const SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-chart-a)',
] as const;

function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

/** Spojnicový graf. Načítá se líně, není součástí základního balíku (kritérium 82). */
export function LineChart({
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
        {/* Rám kolem grafu skrývá tuhle SVG před čtečkou (`aria-hidden`) a nese
            skutečnou textovou i klávesovou alternativu v tabulce, viz ChartFrame.
            Rechartsí vlastní klávesová vrstva (`accessibilityLayer`, výchozí
            zapnutá) by jinak vložila do skrytého stromu fokusovatelné `<svg
            tabindex="0" role="application">`, na které nejde z klávesnice
            smysluplně reagovat a čtečka ho navíc nikdy neuvidí. Axe to hlásí
            jako `aria-hidden-focus`. */}
        <RechartsLine data={data} accessibilityLayer={false}>
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
            <Line
              key={item.id}
              type="monotone"
              dataKey={item.id}
              stroke={colorFor(index)}
              strokeDasharray={STROKE_PATTERNS[item.pattern] ?? ''}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RechartsLine>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
