'use client';

import { ChartFrame, type ChartLabels, type ChartSeries } from './chart-frame';

/** Kreslicí plocha v souřadnicích SVG. Odpovídá návrhu Přehledu. */
const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 220;
/** Tři vodorovné linky, mezi nimiž křivka leží. */
const GRID_LINES = [20, 90, 160];
const TOP = 20;
const BOTTOM = 160;

/**
 * Úsporná křivka: tři vodorovné linky, jedna čára, tečky a mono popisky.
 *
 * KDY TUHLE A KDY `LineChart`:
 *
 * - **`TrendChart`** je na kartě uvnitř obrazovky, kde graf není hlavní obsah,
 *   ale doplněk k číslům vedle něj: Přehled, dlaždice na Statistikách. Nemá
 *   osy s popisky ani legendu, protože jedna řada legendu nepotřebuje a osa
 *   by na kartě vysoké 220 px sebrala třetinu místa. Návrh ji tak má.
 * - **`LineChart`** je pro obrazovku, kde je graf tím hlavním a je v něm víc
 *   řad: rozpad po kampaních, srovnání období. Má osy, mřížku i legendu
 *   s rozlišením vzorem čáry.
 *
 * Kreslí se ručním SVG, ne recharts. Není to tvrdohlavost: recharts se načítá
 * líně a váží svoje, kdežto tahle křivka je pár čar a nic z knihovny
 * nepotřebuje. Karta s ní se tedy vykreslí bez čekání na další balík.
 *
 * TABULKA ZŮSTÁVÁ. Rám `ChartFrame` je společný oběma grafům, takže i tady
 * je SVG pro čtečku skryté a hodnoty nese rozbalovací tabulka. Barva nikdy
 * není jediným nositelem informace a čísla jdou přečíst i mimo graf.
 */
export function TrendChart({
  title,
  hideTitle,
  series,
  labels,
  formatValue,
  className,
}: {
  title: string;
  /** Skryje viditelný nadpis, přístupné jméno zůstane. Viz `ChartFrame`. */
  hideTitle?: boolean;
  /**
   * Jedna řada. Víc jich komponenta schválně neumí: návrh pro ně nemá barvy
   * a dvě nerozlišené čáry vedle sebe jsou horší než žádný graf. Na víc řad
   * je `LineChart`.
   */
  series: ChartSeries;
  labels: ChartLabels;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const points = series.points;
  const values = points.map((point) => point.y);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const coords = points.map((point, index) => {
    const x = points.length <= 1 ? VIEW_WIDTH / 2 : (index / (points.length - 1)) * VIEW_WIDTH;
    const y = BOTTOM - ((point.y - min) / span) * (BOTTOM - TOP);
    return { x, y, label: point.x };
  });

  return (
    <ChartFrame
      title={title}
      {...(hideTitle === undefined ? {} : { hideTitle })}
      series={[series]}
      labels={labels}
      className={className ?? ''}
      {...(formatValue ? { formatValue } : {})}
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        // `overflow: visible` nechá tečku na kraji celou. Bez toho ji rám
        // ořízne v půlce, protože leží přesně na hranici plochy.
        className="h-[220px] w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {GRID_LINES.map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2={VIEW_WIDTH}
            y2={y}
            stroke="var(--color-border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke="var(--color-primary-hover)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((point) => (
          <circle
            key={point.label}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="var(--color-panel)"
            stroke="var(--color-primary)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="mt-[var(--spacing-inline)] flex justify-between">
        {coords.map((point) => (
          <span key={point.label} className="font-mono text-label text-text-muted">
            {point.label}
          </span>
        ))}
      </div>
    </ChartFrame>
  );
}
