'use client';

// Podcesta na úroveň adresáře. `patterns/charts/lazy` je vlastní položka
// v `exports` a jediná povolená cesta ke grafům: recharts se do základního
// balíku nesmí dostat (kritérium 82). Import souboru, například
// `patterns/charts/line-chart`, skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`.
import { LineChart } from '@mlain/ui/patterns/charts/lazy';
import type { ChartSeries } from '@mlain/ui/patterns/charts';

/** Tvar, ve kterém reporty data mají: bod v čase a k němu hodnoty všech řad. */
export type ReportSeries = { key: string; label: string };
export type ReportPoint = { at: string; values: Record<string, number> };

export type ReportChartProps = {
  title: string;
  series: ReportSeries[];
  points: ReportPoint[];
  /** Popisky tabulkové alternativy. K7 je vyžaduje, prázdné být nesmějí. */
  labels: { showTable: string; hideTable: string; tableCaption: string; periodColumn: string };
  formatValue?: (value: number) => string;
  formatPeriod?: (iso: string) => string;
};

/** Vzory čar, aby graf zůstal čitelný bez rozlišení barev (tvrdý požadavek K7). */
const PATTERNS = ['solid', 'dashed', 'dotted'] as const;

/**
 * Jediné místo, kde se reportové obrazovky dotýkají komponenty K7 z packages/ui.
 *
 * Překlad je tady schválně: reporty drží data jako „bod a k němu hodnoty“,
 * K7 je chce jako „řada a k ní body“. Kdyby si každá obrazovka převáděla
 * sama, byl by rozdíl v props P05 změnou na dvaceti místech.
 *
 * Tabulková alternativa, klávesová dostupnost hodnot i osa Y od nuly jsou
 * uvnitř K7, tenhle soubor je nezajišťuje ani nepřepisuje.
 */
export function ReportChart(props: ReportChartProps) {
  const format = props.formatPeriod ?? ((iso: string) => iso);
  const series: ChartSeries[] = props.series.map((item, index) => ({
    id: item.key,
    label: item.label,
    pattern: PATTERNS[index % PATTERNS.length] ?? 'solid',
    points: props.points.map((point) => ({
      x: format(point.at),
      y: point.values[item.key] ?? 0,
    })),
  }));

  return (
    <LineChart
      title={props.title}
      series={series}
      labels={props.labels}
      {...(props.formatValue ? { formatValue: props.formatValue } : {})}
    />
  );
}
