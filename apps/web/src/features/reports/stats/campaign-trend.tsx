'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Card, CardFooter, CardHeader } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { cn } from '@mlain/ui/lib/cn';
import { CircleQuestionMark, MailOpen, MousePointerClick, Send } from '@mlain/ui/icons';
import { fetchJson } from '../api-client';
import { PeriodSwitch } from './period-switch';
import { trendRows, withKnownDelivery, type TrendCampaign } from './trend-series';

const ReportChart = dynamic(() => import('../adapters/report-chart').then((m) => m.ReportChart), {
  ssr: false,
});

const MIN_CAMPAIGNS_FOR_TREND = 3;

/** Období, která obrazovka nabízí. Musí se shodovat s `DASHBOARD_PERIODS` na serveru. */
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/**
 * Výchozí období je 90 dní, ne 30 jako na Přehledu.
 *
 * Přehled odpovídá na „co se děje teď", tahle obrazovka na „zlepšuju se, nebo
 * zhoršuju". Trend se navíc kreslí až od třetí kampaně, takže kratší okno by
 * u běžné instalace ukázalo prázdno tam, kde data jsou.
 */
const DEFAULT_PERIOD: Period = 90;

/**
 * Řady v grafu. VĚDOMĚ TŘI, ne čtyři: `patterns/charts` má tři barvy a tři
 * vzory čar a čtvrtá řada by dostala tutéž plnou čáru v téže žluté jako první
 * („Doručeno" a „Odhlásilo se" by v grafu splynuly). Odhlášení proto nese
 * tabulka pod grafem, kde je stejně dostupné z klávesnice i pro odečítač.
 */
const CHART_SERIES = [
  { key: 'delivered', labelKey: 'stats.seriesDelivered' },
  { key: 'opened', labelKey: 'stats.seriesOpened' },
  { key: 'clicked', labelKey: 'stats.seriesClicked' },
] as const;

type DashboardTile =
  | { status: 'ok'; data: Record<string, unknown>; computed_at?: string; stale?: boolean }
  | { status: 'error'; code: string };

type DashboardPayload = {
  period_days: number;
  computed_at: string;
  tiles: Record<string, DashboardTile>;
};

/**
 * Dlaždice s číslem. NENÍ to komponenta katalogu (kapitola 4 základu designu):
 * skládá se z `Card`, mono verzálek a velkého čísla přímo na obrazovce, protože
 * každá stránka ji potřebuje jinak. Tahle je dlaždice STATISTIK.
 */
function Tile({
  label,
  icon,
  iconTone,
  tone = 'plain',
  footer,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  iconTone: string;
  tone?: 'plain' | 'highlight';
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const labelId = useId();
  const highlight = tone === 'highlight';

  return (
    <Card
      padding="md"
      aria-labelledby={labelId}
      {...(highlight ? { tone: 'highlight' as const } : {})}
    >
      <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
        {/* Popisek dlaždice je NADPIS, ne jen text v mono verzálkách: podle něj
            se orientuje odečítač obrazovky. */}
        <h2
          id={labelId}
          className={cn('meta-caps', highlight ? 'text-warning-text' : 'text-text-muted')}
        >
          {label}
        </h2>
        <span
          aria-hidden
          className={cn(
            'inline-flex size-[var(--size-control-sm)] shrink-0 items-center justify-center',
            'rounded-[var(--radius-control)]',
            iconTone,
          )}
        >
          {icon}
        </span>
      </div>
      {children}
      {footer ? (
        <CardFooter className={highlight ? 'border-primary-hover' : ''}>{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

/** Velké číslo dlaždice. */
function TileValue({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-display leading-[var(--leading-number)] font-semibold tracking-[var(--tracking-number)] text-text">
      {children}
    </p>
  );
}

/**
 * Změna proti minulému období. BARVA NENÍ JEDINÝ NOSIČ: znaménko je součástí
 * textu, takže se směr pozná i bez rozlišení barev. Když se není s čím
 * porovnat, řádek se nevykreslí; nula by tvrdila, že se nic nezměnilo.
 */
function TileDelta({
  value,
  label,
  format,
  muted,
}: {
  value: number;
  label: string;
  format: (value: number) => string;
  muted: string;
}) {
  return (
    <div className="flex items-center gap-[var(--spacing-inline)]">
      <span
        className={cn(
          'font-mono text-meta whitespace-nowrap',
          value >= 0 ? 'text-success-text' : 'text-danger-text',
        )}
      >
        {/* Mínus si dodá formátovač čísla sám, plus musí dopsat kód. */}
        {value > 0 ? '+' : ''}
        {format(value)}
      </span>
      <span className={cn('text-meta', muted)}>{label}</span>
    </div>
  );
}

/**
 * Vývoj v čase: jak si vedou jednotlivé kampaně období.
 *
 * Vzhled je odvozený z PŘEHLEDU (`Mlain Mailer - Přehled.dc.html`): tentýž
 * přepínač období v hlavičce, tytéž dlaždice s číslem a rozdílem proti minulému
 * období, tentýž rytmus „hlavička, filtry, karta s obsahem". Čísla dlaždic
 * berou obě obrazovky z jednoho zdroje (`/api/v1/dashboard`), takže se nemůžou
 * rozejít.
 *
 * DO GRAFU JDOU JEN KAMPANĚ SE ZNÁMOU DORUČENOSTÍ. Zdůvodnění je
 * u `withKnownDelivery`; tady zbývá říct, co se stane se zbytkem: napíše se,
 * kolik jich vypadlo a proč, a stojí to i jako vlastní dlaždice. Bez toho by
 * uživatel viděl graf o třech kampaních a nevěděl, kam se poděly zbylé čtyři.
 */
export function CampaignTrend({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [payload, setPayload] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    // Stejný důvod jako u dlaždic přehledu (`dashboard-grid.tsx`): bez
    // `X-Workspace-Id` middleware autentizace projekt nenajde a `/api/v1/dashboard`
    // odpoví 404 místo dat.
    void fetchJson<DashboardPayload>(`/api/v1/dashboard?period=${period}`, {
      workspaceId: workspaceSlug,
    })
      .then((result) => {
        if (cancelled || result.status !== 'ok') return;
        setPayload(result.data);
      })
      .catch(() => {
        // Selhání se chová jako prázdné dlaždice, ne jako bílá stránka.
        if (!cancelled) {
          setPayload({ period_days: period, computed_at: new Date().toISOString(), tiles: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [period, workspaceSlug]);

  const rangeLabel = t(`dashboard.period${period}`);
  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 1 });
  const deltaLabel = t('dashboard.deltaSincePrevious');

  /**
   * Čas výpočtu se do meta řádku dostane, jen když je to platné datum.
   * Odpověď bez `computed_at` (starší server, testovací dvojník) by jinak
   * shodila celou obrazovku na `Invalid Date` uvnitř formátovače.
   */
  const computedAt =
    payload && !Number.isNaN(Date.parse(payload.computed_at))
      ? new Date(payload.computed_at)
      : null;

  const header = (
    <PageHeader
      title={t('stats.campaignsHeading')}
      meta={
        computedAt
          ? t('dashboard.rangeMeta', {
              range: rangeLabel,
              at: format.dateTime(computedAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : rangeLabel
      }
    >
      <PeriodSwitch
        label={t('dashboard.periodLabel')}
        value={period}
        onChange={setPeriod}
        options={PERIODS.map((value) => ({ value, label: t(`dashboard.period${value}`) }))}
      />
    </PageHeader>
  );

  if (!payload) {
    return (
      <>
        {header}
        <div
          aria-busy="true"
          aria-label={t('stats.loading')}
          className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-surface-muted"
        />
      </>
    );
  }

  const dataOf = (tile: DashboardTile | undefined): Record<string, unknown> | null =>
    tile?.status === 'ok' ? tile.data : null;
  const unknownOf = (tile: DashboardTile | undefined): number =>
    Number((dataOf(tile)?.unknown as { campaigns?: number } | undefined)?.campaigns ?? 0);
  const deltaOf = (tile: DashboardTile | undefined): number | null => {
    const value = dataOf(tile)?.delta;
    return typeof value === 'number' ? value : null;
  };

  const sentTile = payload.tiles.sent;
  const opensTile = payload.tiles.open_rate;
  const clicksTile = payload.tiles.click_rate;

  const campaigns = ((dataOf(payload.tiles.recent_campaigns)?.items ?? []) as TrendCampaign[])
    // Kampaň bez data odeslání nemá na časové ose kam sednout.
    .filter((campaign) => Boolean(campaign.startedAt));
  const usable = withKnownDelivery(campaigns);
  const excluded = campaigns.length - usable.length;
  const rows = trendRows(usable);

  const tiles = (
    <div className="mb-[var(--spacing-gutter)] grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-[var(--spacing-gutter)]">
      <Tile
        label={t('dashboard.sent')}
        icon={<Send aria-hidden className="icon-md" />}
        iconTone="bg-accent-surface text-warning-text"
        footer={
          <span className="font-mono text-meta text-text-muted">
            {t('stats.campaignsInPeriod', { count: campaigns.length })}
          </span>
        }
      >
        {sentTile?.status === 'ok' ? (
          <TileValue>{format.number(Number(sentTile.data.value ?? 0))}</TileValue>
        ) : (
          <p role="alert" className="text-ui text-text-muted">
            {t('dashboard.tileError')}
          </p>
        )}
        {deltaOf(sentTile) !== null ? (
          <TileDelta
            value={deltaOf(sentTile) ?? 0}
            label={deltaLabel}
            format={percent}
            muted="text-text-muted"
          />
        ) : null}
      </Tile>

      <Tile
        label={t('dashboard.opened')}
        icon={<MailOpen aria-hidden className="icon-md" />}
        iconTone="bg-success-surface text-success-text"
        {...(typeof dataOf(opensTile)?.machineShare === 'number'
          ? {
              footer: (
                <span className="font-mono text-meta text-text-muted">
                  {t('dashboard.openedMachine', {
                    share: format.number(Number(dataOf(opensTile)?.machineShare ?? 0), {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    }),
                  })}
                </span>
              ),
            }
          : {})}
      >
        {opensTile?.status === 'error' ? (
          <p role="alert" className="text-ui text-text-muted">
            {t('dashboard.tileError')}
          </p>
        ) : typeof dataOf(opensTile)?.rate === 'number' ? (
          <>
            <TileValue>{percent(Number(dataOf(opensTile)?.rate))}</TileValue>
            {deltaOf(opensTile) !== null ? (
              <TileDelta
                value={deltaOf(opensTile) ?? 0}
                label={deltaLabel}
                format={percent}
                muted="text-text-muted"
              />
            ) : null}
          </>
        ) : unknownOf(opensTile) > 0 ? (
          <>
            <TileValue>
              <span data-testid="opens-absolute">
                {t('dashboard.openedAbsolute', { count: Number(dataOf(opensTile)?.opens ?? 0) })}
              </span>
            </TileValue>
            <p className="text-meta text-text-muted">
              {t('dashboard.rateUnknown', { count: unknownOf(opensTile) })}
            </p>
          </>
        ) : (
          <p className="text-ui text-text-muted">{t('dashboard.emptyNoCampaigns')}</p>
        )}
      </Tile>

      {/* Proklik je hlavní číslo sekce, proto jediná zvýrazněná dlaždice. */}
      <Tile
        label={t('dashboard.clicked')}
        tone="highlight"
        icon={<MousePointerClick aria-hidden className="icon-md" />}
        iconTone="bg-panel text-primary"
        footer={<span className="text-meta text-warning-text">{t('dashboard.clickedHint')}</span>}
      >
        {clicksTile?.status === 'error' ? (
          <p role="alert" className="text-ui text-warning-text">
            {t('dashboard.tileError')}
          </p>
        ) : typeof dataOf(clicksTile)?.rate === 'number' ? (
          <>
            <TileValue>{percent(Number(dataOf(clicksTile)?.rate))}</TileValue>
            {deltaOf(clicksTile) !== null ? (
              <TileDelta
                value={deltaOf(clicksTile) ?? 0}
                label={deltaLabel}
                format={percent}
                muted="text-warning-text"
              />
            ) : null}
          </>
        ) : unknownOf(clicksTile) > 0 ? (
          <>
            <TileValue>
              <span data-testid="clicks-absolute">
                {t('dashboard.clickedAbsolute', { count: Number(dataOf(clicksTile)?.clicks ?? 0) })}
              </span>
            </TileValue>
            <p className="text-meta text-warning-text">
              {t('dashboard.rateUnknown', { count: unknownOf(clicksTile) })}
            </p>
          </>
        ) : (
          <p className="text-ui text-warning-text">{t('dashboard.emptyNoCampaigns')}</p>
        )}
      </Tile>

      {/*
        Dlaždice, kvůli které tahle obrazovka nelže. Kampaň, u které neznáme
        doručenost, se z měr vypouští; kdyby o tom obrazovka mlčela, vypadal by
        graf o třech kampaních jako celý obraz období.
      */}
      <Tile
        label={t('stats.excludedLabel')}
        icon={<CircleQuestionMark aria-hidden className="icon-md" />}
        iconTone="bg-surface-muted text-text-muted"
        footer={<span className="text-meta text-text-muted">{t('stats.excludedHint')}</span>}
      >
        <TileValue>
          <span data-testid="trend-excluded-count">{format.number(excluded)}</span>
        </TileValue>
      </Tile>
    </div>
  );

  if (usable.length < MIN_CAMPAIGNS_FOR_TREND) {
    return (
      <>
        {header}
        {tiles}
        <Card>
          <CardHeader title={t('stats.chartHeading')} meta={rangeLabel} />
          <p className="text-ui text-text-muted" data-testid="trend-empty">
            {t('stats.emptyTooFew')}
          </p>
          {excluded > 0 ? (
            <p className="text-sm text-text-muted" data-testid="trend-excluded">
              {t('stats.excludedUnknown', { count: excluded })}
            </p>
          ) : null}
          <CardFooter>
            <Link href={`/w/${workspaceSlug}/campaigns`} className="text-ui">
              {t('dashboard.allCampaigns')}
            </Link>
          </CardFooter>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {tiles}

      <Card className="mb-[var(--spacing-gutter)]">
        <CardHeader
          title={t('stats.chartHeading')}
          meta={t('dashboard.rangeWords', { range: rangeLabel })}
        />
        {/* Nadpis grafu nese hlavička karty, takže popisek uvnitř rámu je jen
            pro odečítač. Skrývá se z KARTY, ne zásahem do sdílené komponenty:
            `figure` musí mít pořád na co ukazovat přes `aria-labelledby`. */}
        <div className="[&_figcaption]:sr-only">
          <ReportChart
            title={t('stats.chartHeading')}
            labels={{
              showTable: t('chart.showTable'),
              hideTable: t('chart.hideTable'),
              tableCaption: t('stats.tableCaption'),
              periodColumn: t('stats.columnSentAt'),
            }}
            formatValue={percent}
            formatPeriod={(iso) => format.dateTime(new Date(iso), { dateStyle: 'short' })}
            series={CHART_SERIES.map((serie) => ({ key: serie.key, label: t(serie.labelKey) }))}
            points={rows.map((row) => ({ at: row.at, values: row.values }))}
          />
        </div>
        <CardFooter className="flex-wrap">
          {/*
            Osa Y kreslí holá čísla 0 až 1, protože `patterns/charts` formátovač
            hodnot na osu nepouští (dostane ho jen tabulková alternativa). Bez
            věty by „1" na ose vypadalo jako jeden kus, ne jako sto procent.
            Přesná čísla jsou v tabulce pod grafem i v tabulkové alternativě.
          */}
          <span className="text-meta text-text-muted">{t('stats.chartAxisNote')}</span>
          <span className="text-meta text-text-muted">{t('stats.openWithMachineNote')}</span>
          {excluded > 0 ? (
            <span className="text-meta text-text-muted" data-testid="trend-excluded">
              {t('stats.excludedUnknown', { count: excluded })}
            </span>
          ) : null}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader
          title={t('stats.tableCaption')}
          action={<Link href={`/w/${workspaceSlug}/campaigns`}>{t('dashboard.allCampaigns')}</Link>}
        />
        {/*
          SKUTEČNÁ TABULKA, ne mřížka z `div`ů. Návrh kreslí seznam kampaní jako
          mřížku, ale tady jde o čísla ve sloupcích: bez `th scope` by odečítač
          u hodnoty neřekl, ke které kampani a ke které míře patří. Přístupnost
          má přednost před doslovným opisem náhledu (pravidlo 9 základu designu),
          vzhled řádku i hlavičky zůstává z návrhu.
        */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t('stats.tableCaption')}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="meta-caps py-[var(--spacing-inline)] text-text-muted">
                  {t('stats.columnCampaign')}
                </th>
                <th
                  scope="col"
                  className="meta-caps py-[var(--spacing-inline)] text-right text-text-muted"
                >
                  {t('stats.seriesDelivered')}
                </th>
                <th
                  scope="col"
                  className="meta-caps py-[var(--spacing-inline)] text-right text-text-muted"
                >
                  {t('stats.seriesOpened')}
                </th>
                <th
                  scope="col"
                  className="meta-caps py-[var(--spacing-inline)] text-right text-text-muted"
                >
                  {t('stats.seriesClicked')}
                </th>
                <th
                  scope="col"
                  className="meta-caps py-[var(--spacing-inline)] text-right text-text-muted"
                >
                  {t('stats.seriesUnsubscribed')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.campaignId}
                  className={cn(index < rows.length - 1 ? 'border-b border-border' : '')}
                >
                  {/*
                    Jméno kampaně je ODKAZ NA JEJÍ REPORT. Bez něj byly Statistiky
                    slepá ulice: tabulka vypsala míry deseti kampaní a k té jedné,
                    která uživatele zajímá, se odsud nedalo prokliknout.
                  */}
                  <th scope="row" className="py-[var(--spacing-row-y)] pr-[var(--spacing-stack)]">
                    <span className="flex min-w-0 flex-col gap-[var(--spacing-hairline)]">
                      <Link
                        href={`/w/${workspaceSlug}/campaigns/${row.campaignId}/report`}
                        className="truncate text-ui font-semibold text-text no-underline hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="font-mono text-meta font-normal text-text-muted">
                        {format.dateTime(new Date(row.at), { dateStyle: 'short' })}
                      </span>
                    </span>
                  </th>

                  <td className="py-[var(--spacing-row-y)] text-right font-mono text-meta whitespace-nowrap text-text">
                    {percent(row.values.delivered)}
                  </td>
                  <td className="py-[var(--spacing-row-y)] text-right">
                    <span className="flex flex-col items-end gap-[var(--spacing-hairline)]">
                      <span className="font-mono text-meta whitespace-nowrap text-text">
                        {percent(row.values.opened)}
                      </span>
                      <span className="font-mono text-label text-text-muted">
                        {t('dashboard.openedMachine', {
                          share: format.number(row.machineShare, {
                            style: 'percent',
                            maximumFractionDigits: 0,
                          }),
                        })}
                      </span>
                    </span>
                  </td>
                  <td className="py-[var(--spacing-row-y)] text-right">
                    <Badge tone={row.values.clicked > 0 ? 'success' : 'neutral'}>
                      {percent(row.values.clicked)}
                    </Badge>
                  </td>
                  <td className="py-[var(--spacing-row-y)] text-right font-mono text-meta whitespace-nowrap text-text-muted">
                    {percent(row.values.unsubscribed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
