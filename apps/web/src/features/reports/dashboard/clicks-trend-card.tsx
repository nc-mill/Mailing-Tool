'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardHeader } from '@mlain/ui/components/card';
import { ReportChart } from '../adapters/report-chart';

export type TrendPoint = { campaignId: string; startedAt: string | null; clicks: number };

/**
 * Vývoj prokliků v čase. Bod na ose je JEDNA KAMPAŇ, ne den v kalendáři:
 * přehled o jednotlivých dnech nic neví, dlaždice `recent_campaigns` nese
 * kampaně období i s počty. Kreslí se počet ověřených prokliků, tedy měření,
 * ne dopočtená míra: podíl by u kampaně bez zpětné vazby od odesílací služby
 * neměl jmenovatel a čára by popisovala odhad.
 *
 * Graf je komponenta z `@mlain/ui/patterns/charts` (načítá se líně, recharts
 * do základního balíku nepatří). Vlastní SVG by přišlo o tabulkovou
 * alternativu, kterou rám kolem grafu drží kvůli odečítačům obrazovky.
 */
export function ClicksTrendCard({
  points,
  rangeLabel,
  statsHref,
}: {
  points: TrendPoint[];
  /** „za posledních 30 dní" vedle nadpisu. */
  rangeLabel: string;
  statsHref: string;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  /**
   * Bod na ose je DEN, ne kampaň. Dvě kampaně odeslané v jeden den se sečtou.
   *
   * Kdyby byl bodem každá kampaň zvlášť, měly by dva body stejný popisek
   * („4. 8.") a rám kolem grafu je klíčuje popiskem: React by pak jeden řádek
   * tabulkové alternativy zahodil. Součet za den je navíc to, na co se
   * uživatel dívá, když se ptá „kdy se klikalo".
   */
  const byDay = new Map<string, { at: string; clicks: number }>();
  for (const point of points) {
    if (point.startedAt === null) continue;
    const day = point.startedAt.slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.clicks += point.clicks;
    else byDay.set(day, { at: point.startedAt, clicks: point.clicks });
  }
  const ordered = [...byDay.values()].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <Card className="col-span-12 lg:col-span-8">
      <CardHeader
        title={t('dashboard.clicksTrend')}
        meta={rangeLabel}
        action={
          <Link href={statsHref} data-testid="clicks-trend-link">
            {t('dashboard.clicksTrendAction')}
          </Link>
        }
      />
      {ordered.length === 0 ? (
        <p className="text-ui text-text-muted">{t('dashboard.clicksTrendEmpty')}</p>
      ) : (
        // Nadpis grafu nese hlavička karty, takže popisek uvnitř rámu je jen
        // pro odečítač. Skrývá se z KARTY, ne zásahem do sdílené komponenty:
        // `figure` musí mít pořád na co ukazovat přes `aria-labelledby`.
        <div className="[&_figcaption]:sr-only">
          <ReportChart
            title={t('dashboard.clicksTrend')}
            series={[{ key: 'clicks', label: t('dashboard.clicksSeries') }]}
            points={ordered.map((point) => ({
              at: point.at,
              values: { clicks: point.clicks },
            }))}
            labels={{
              showTable: t('chart.showTable'),
              hideTable: t('chart.hideTable'),
              tableCaption: t('dashboard.clicksTrendCaption'),
              periodColumn: t('dashboard.clicksTrendColumn'),
            }}
            formatValue={(value) => format.number(value)}
            formatPeriod={(iso) =>
              format.dateTime(new Date(iso), { day: 'numeric', month: 'numeric' })
            }
          />
        </div>
      )}
    </Card>
  );
}
