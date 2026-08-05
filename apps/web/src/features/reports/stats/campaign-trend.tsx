'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchJson } from '../api-client';
import { trendRows, trendSeries, withKnownDelivery, type TrendCampaign } from './trend-series';

const ReportChart = dynamic(() => import('../adapters/report-chart').then((m) => m.ReportChart), {
  ssr: false,
});

const MIN_CAMPAIGNS_FOR_TREND = 3;

export function CampaignTrend({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [campaigns, setCampaigns] = useState<TrendCampaign[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Stejný důvod jako u dlaždic přehledu (`dashboard-grid.tsx`): bez
    // `X-Workspace-Id` middleware autentizace projekt nenajde a `/api/v1/dashboard`
    // odpoví 404 místo dat.
    void fetchJson<{
      tiles: Record<string, { status: string; data?: { items?: TrendCampaign[] } }>;
    }>('/api/v1/dashboard?period=90', { workspaceId: workspaceSlug })
      .then((result) => {
        if (cancelled || result.status !== 'ok') return;
        const tile = result.data.tiles.recent_campaigns;
        setCampaigns(tile?.status === 'ok' ? (tile.data?.items ?? []) : []);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  if (!campaigns)
    return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-surface-muted" />;

  /*
   * Do grafu jdou JEN kampaně se známou doručeností. Zdůvodnění je
   * u `withKnownDelivery`; tady zbývá rozhodnout, co se stane se zbytkem:
   * napíše se, kolik jich vypadlo a proč. Bez té věty by uživatel viděl
   * graf o třech kampaních a nevěděl, kam se poděly zbylé čtyři.
   */
  const usable = withKnownDelivery(campaigns);
  const excluded = campaigns.length - usable.length;

  const excludedNote =
    excluded === 0 ? null : (
      <p className="mt-2 text-sm text-text-muted" data-testid="trend-excluded">
        {t('stats.excludedUnknown', { count: excluded })}
      </p>
    );

  if (usable.length < MIN_CAMPAIGNS_FOR_TREND) {
    return (
      <section aria-labelledby="trend-heading">
        <h1 id="trend-heading" className="text-2xl font-semibold">
          {t('stats.campaignsHeading')}
        </h1>
        <p className="mt-2 text-text-muted">{t('stats.emptyTooFew')}</p>
        {excludedNote}
      </section>
    );
  }

  const rows = trendRows(usable);

  return (
    <section aria-labelledby="trend-heading" className="flex flex-col gap-4">
      <h1 id="trend-heading" className="text-2xl font-semibold">
        {t('stats.campaignsHeading')}
      </h1>
      <p className="text-sm text-text-muted">{t('stats.openWithMachineNote')}</p>
      {excludedNote}
      <ReportChart
        title={t('stats.campaignsHeading')}
        labels={{
          showTable: t('chart.showTable'),
          hideTable: t('chart.hideTable'),
          tableCaption: t('stats.tableCaption'),
          periodColumn: t('stats.columnSentAt'),
        }}
        formatValue={(value) =>
          format.number(value, { style: 'percent', maximumFractionDigits: 1 })
        }
        formatPeriod={(iso) => format.dateTime(new Date(iso), { dateStyle: 'short' })}
        series={trendSeries(campaigns).map((serie) => ({
          key: serie.key,
          label: t(serie.labelKey),
        }))}
        points={rows.map((row) => ({ at: row.at, values: row.values }))}
      />
      <table className="w-full text-sm">
        <caption className="pb-2 text-left text-base font-semibold">
          {t('stats.tableCaption')}
        </caption>
        <thead>
          <tr className="border-b border-border text-xs text-text-muted">
            <th scope="col" className="pb-2 text-left font-normal">
              {t('stats.columnCampaign')}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t('stats.seriesClicked')}
            </th>
            <th scope="col" className="pb-2 text-right font-normal">
              {t('stats.seriesOpened')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.campaignId} className="border-t border-border first:border-t-0">
              {/*
                Jméno kampaně je ODKAZ NA JEJÍ REPORT. Bez něj byly Statistiky
                slepá ulice: tabulka vypsala míry deseti kampaní a k té jedné,
                která uživatele zajímá, se odsud nedalo prokliknout. Stejně to
                dělá dlaždice posledních kampaní na přehledu.
              */}
              <th scope="row" className="py-2 text-left font-normal">
                <Link
                  href={`/w/${workspaceSlug}/campaigns/${row.campaignId}/report`}
                  className="underline"
                >
                  {row.name}
                </Link>
              </th>
              <td className="py-2 text-right tabular-nums">
                {format.number(row.values.clicked, { style: 'percent', maximumFractionDigits: 1 })}
              </td>
              <td className="py-2 text-right tabular-nums">
                {format.number(row.values.opened, { style: 'percent', maximumFractionDigits: 1 })}
                <span className="ml-1 text-xs text-text-muted">
                  {t('dashboard.openedMachine', {
                    share: format.number(row.machineShare, {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    }),
                  })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
