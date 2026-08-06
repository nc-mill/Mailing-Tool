'use client';

import { useId, useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

/**
 * Vzor čáry. **Barva nikdy není jediným nositelem informace** (WCAG 1.4.1),
 * takže se řady rozlišují i tvarem. Čtyři vzory jsou strop: pátá řada už se
 * nedá spolehlivě rozlišit ani tvarem, a patří tedy do tabulky, ne do grafu.
 */
export type SeriesPattern = 'solid' | 'dashed' | 'dotted' | 'dashDot';

export type ChartSeries = {
  id: string;
  label: string;
  /** Vzor čáry nebo výplně. Graf musí být čitelný bez rozlišení barev. */
  pattern: SeriesPattern;
  points: Array<{ x: string; y: number }>;
};

export type ChartLabels = {
  showTable: string;
  hideTable: string;
  tableCaption: string;
  periodColumn: string;
};

/**
 * Rám kolem každého grafu v aplikaci.
 *
 * Vizuální graf je pro čtečku skrytý (`aria-hidden`), protože SVG plné
 * cest nikomu nic neřekne. Data nese **tabulka**, která je vždy v DOM
 * a jde rozbalit z klávesnice. Tím je splněná textová alternativa
 * i klávesová dostupnost hodnot naráz.
 */
export function ChartFrame({
  title,
  hideTitle = false,
  series,
  labels,
  children,
  formatValue = (value) => new Intl.NumberFormat('cs').format(value),
  className,
}: {
  title: string;
  /**
   * Skryje viditelný nadpis grafu, ale **NE jeho přístupné jméno**.
   *
   * K čemu: graf skoro vždycky sedí v kartě, která už nadpis má, a nadpis se
   * pak na obrazovce objeví dvakrát pod sebou. Mizet má ten grafový, protože
   * nadpis karty je systémový prvek a vypadá na všech obrazovkách stejně.
   *
   * Nadpis se **nemaže, jen se schová do `sr-only`**. Kdyby zmizel úplně,
   * přišel by graf i s tabulkou o jméno a čtečka by ohlásila „obrázek" bez
   * dalšího. Ta cena za srovnaný vzhled je zbytečná, když stačí nadpis
   * přesunout mimo obraz.
   */
  hideTitle?: boolean;
  series: ChartSeries[];
  labels: ChartLabels;
  /** Samotný graf, například `<LineChart>` z recharts. */
  children: React.ReactNode;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const periods = series[0]?.points.map((point) => point.x) ?? [];

  return (
    <figure aria-labelledby={titleId} className={cn('flex flex-col gap-3', className)}>
      <figcaption
        id={titleId}
        className={cn(hideTitle ? 'sr-only' : 'text-h3 font-semibold text-text')}
      >
        {title}
      </figcaption>

      <div data-testid="chart-visual" aria-hidden="true">
        {children}
      </div>

      <div data-testid="chart-legend" className="flex flex-wrap gap-4 text-sm text-text">
        {series.map((item) => (
          <span key={item.id} className="flex items-center gap-2">
            <span
              data-pattern={item.pattern}
              aria-hidden
              className={cn(
                'inline-block h-0.5 w-6 border-t-2 border-text',
                item.pattern === 'dashed' ? 'border-dashed' : '',
                item.pattern === 'dotted' ? 'border-dotted' : '',
                item.pattern === 'dashDot' ? 'border-double' : '',
              )}
            />
            {item.label}
          </span>
        ))}
      </div>

      <div>
        <Button variant="link" onClick={() => setOpen((current) => !current)}>
          {open ? labels.hideTable : labels.showTable}
        </Button>
      </div>

      {/* Tabulka je v DOM vždy. Když je sbalená, je jen vizuálně skrytá,
          takže ji čtečka i klávesnice pořád najdou. */}
      <div className={open ? '' : 'sr-only'}>
        <table className="w-full text-sm">
          <caption className="sr-only">{labels.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-left text-text-muted">
                {labels.periodColumn}
              </th>
              {series.map((item) => (
                <th key={item.id} scope="col" className="p-2 text-right text-text-muted">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => (
              <tr key={period} className="border-t border-border">
                <th scope="row" className="p-2 text-left font-normal text-text">
                  {period}
                </th>
                {series.map((item) => (
                  <td key={item.id} className="p-2 text-right text-text">
                    {formatValue(item.points[index]?.y ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
