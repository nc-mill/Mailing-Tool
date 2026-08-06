'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Card, CardHeader } from '@mlain/ui/components/card';
import { cn } from '@mlain/ui/lib/cn';

export type RecentCampaignRow = {
  campaignId: string;
  name: string;
  clickRate: number | null;
  deliveredKnown?: boolean;
  clicks?: number;
  sent?: number;
};

/** Kolik kampaní se vejde do dlaždice. Zbytek je za odkazem „Všechny kampaně". */
const VISIBLE_ROWS = 5;

/** Mřížka řádku. Stejná v hlavičce i v řádcích, jinak by sloupce neseděly pod sebou. */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_90px_90px_130px] gap-[var(--spacing-stack)]';

/**
 * Iniciály kampaně. Dvě písmena z prvních dvou slov názvu, verzálkami.
 * Je to ozdoba řádku, ne informace, takže ji odečítač obrazovky přeskočí.
 */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word.charAt(0).toLocaleUpperCase('cs')).join('') || '—';
}

/**
 * Poslední kampaně období.
 *
 * MÍRA SE UKÁŽE JEN TAM, KDE MÁ JMENOVATELE. U kampaně, o jejíž doručenosti
 * nevíme nic, stojí ve stavu POČET prokliků, ne procento: dřív tu u čerstvě
 * odeslané kampaně svítilo „100 %", protože se jmenovatel dopočítal z odeslaných.
 */
export function RecentCampaignsCard({
  items,
  basePath,
  error,
}: {
  items: RecentCampaignRow[];
  /** `/w/{slug}`, odkazy si karta skládá sama. */
  basePath: string;
  error?: boolean;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const rows = items.slice(0, VISIBLE_ROWS);

  return (
    <Card>
      <CardHeader
        title={t('dashboard.recentCampaigns')}
        action={<Link href={`${basePath}/campaigns`}>{t('dashboard.allCampaigns')}</Link>}
      />

      {error ? (
        <p role="alert" className="text-ui text-text-muted">
          {t('dashboard.tileError')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-ui text-text-muted">{t('dashboard.recentEmpty')}</p>
      ) : (
        <div className="flex flex-col">
          <div
            className={cn(
              ROW_GRID,
              'border-b border-border py-[var(--spacing-inline)] text-text-muted',
            )}
          >
            <span className="meta-caps">{t('dashboard.columnCampaign')}</span>
            <span className="meta-caps">{t('dashboard.sent')}</span>
            <span className="meta-caps">{t('dashboard.columnClicks')}</span>
            <span className="meta-caps">{t('dashboard.columnStatus')}</span>
          </div>

          {rows.map((item, index) => {
            const clicks = Number(item.clicks ?? 0);
            return (
              <div
                key={item.campaignId}
                className={cn(
                  ROW_GRID,
                  'items-center py-[var(--spacing-row-y)]',
                  index < rows.length - 1 ? 'border-b border-border' : '',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-[var(--size-mark)] shrink-0 items-center justify-center',
                      'rounded-[var(--radius-control)] font-mono text-label',
                      clicks > 0
                        ? 'bg-success-surface text-success-text'
                        : 'bg-surface-muted text-text-muted',
                    )}
                  >
                    {initialsOf(item.name)}
                  </span>
                  <Link
                    href={`${basePath}/campaigns/${item.campaignId}/report`}
                    className="truncate text-ui font-semibold text-text no-underline hover:underline"
                  >
                    {item.name}
                  </Link>
                </div>

                <span className="font-mono text-meta text-text-muted">
                  {t('dashboard.sentMessages', { count: Number(item.sent ?? 0) })}
                </span>

                {/* Pomlčka znamená „neměřeno", ne nula. Starší odpověď serveru
                    počty neposílala vůbec. */}
                <span className="font-mono text-meta text-text">
                  {item.clicks === undefined ? '—' : format.number(clicks)}
                </span>

                {item.clickRate !== null ? (
                  <Badge tone={item.clickRate > 0 ? 'success' : 'neutral'}>
                    {format.number(item.clickRate, {
                      style: 'percent',
                      maximumFractionDigits: 1,
                    })}
                  </Badge>
                ) : (
                  <Badge tone={clicks > 0 ? 'success' : 'neutral'}>
                    {t('dashboard.clickedAbsolute', { count: clicks })}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
