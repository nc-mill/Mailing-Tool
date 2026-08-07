'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { ArrowRight, MailOpen, MousePointerClick, Send, TriangleAlert } from '@mlain/ui/icons';
import { dashboardUrl, fetchJson } from '../api-client';
import { ClicksTrendCard } from './clicks-trend-card';
import { RecentCampaignsCard, type RecentCampaignRow } from './recent-campaigns-card';
import { RangeSwitch } from './range-switch';
import { StatDelta, StatTile, StatValue } from './stat-tile';
import { WebActiveCard, type WebActivePerson } from './web-active-card';
import { parsePeriod, type DashboardPeriod, type DashboardSlots } from './dashboard-slots';

type Tile =
  | { status: 'ok'; data: Record<string, unknown>; computed_at: string; stale: boolean }
  | { status: 'error'; code: string };

type DashboardPayload = {
  period_days: number;
  computed_at: string;
  tiles: Record<string, Tile>;
};

const PERIODS = [7, 30, 90] as const;

/**
 * Akce, na kterou přihlášený člověk nemá právo. NESKRÝVÁ SE, VYSVĚTLUJE SE
 * (pravidlo 2 z 7.2b): skrytá akce vypadá, jako by v produktu nebyla, a člověk
 * neví, co má chtít po kolegovi.
 *
 * Tlačítko není mrtvé a není zašedlé: kliknutí přesune fokus na větu s důvodem,
 * takže se k vysvětlení dostane i ten, kdo obrazovku čte klávesnicí nebo
 * odečítačem. Je to týž postup, jaký si vynutila tichá tlačítka jinde
 * (viz `features/sending/guard-thresholds.tsx`): `unavailableReason` umí jen
 * hlasité varianty tlačítka, a zašedit tichou variantu bez vysvětlení
 * zakazuje kritérium 18.
 */
function ActionWithoutPermission({
  label,
  reason,
  testId,
}: {
  label: string;
  reason: string;
  testId: string;
}) {
  const reasonId = useId();
  const reasonRef = useRef<HTMLParagraphElement | null>(null);

  return (
    <div className="flex min-w-0 flex-col items-start">
      <Button
        variant="secondary"
        aria-describedby={reasonId}
        data-testid={testId}
        onClick={() => reasonRef.current?.focus()}
      >
        {label}
      </Button>
      <p
        id={reasonId}
        ref={reasonRef}
        tabIndex={-1}
        className="mt-1 max-w-[42ch] text-meta text-text-muted"
      >
        {reason}
      </p>
    </div>
  );
}

export function DashboardGrid({
  workspaceSlug,
  slots = {},
  canImportContacts = true,
  canCreateCampaign = true,
}: {
  workspaceSlug: string;
  slots?: DashboardSlots;
  /**
   * Smí přihlášený člověk import (`contacts:import`) a založení kampaně
   * (`campaigns:write`)? Obojí má editor a výš. Bez tohohle rozlišení nabízel
   * Přehled obě akce i prohlížejícímu, který po kliknutí narazil na odmítnutí,
   * aniž by tušil proč.
   */
  canImportContacts?: boolean;
  canCreateCampaign?: boolean;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [period, setPeriod] = useState<DashboardPeriod>(parsePeriod(null));
  const [payload, setPayload] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `workspaceId` je POVINNÝ: bez hlavičky `X-Workspace-Id` middleware
    // autentizace projekt nenajde (cesta je `/api/v1/dashboard`, ne `/w/{slug}/...`)
    // a celý požadavek skončí na 404, ne jen jedna dlaždice. Bez opravy tenhle
    // volaný endpoint reprodukuje přesně to, co viděl uživatel po čerstvé
    // instalaci: čtyři dlaždice s „Tuhle dlaždici se nepodařilo načíst.“
    void fetchJson<DashboardPayload>(dashboardUrl(period), { workspaceId: workspaceSlug })
      .then((result) => {
        if (!cancelled && result.status === 'ok') setPayload(result.data);
      })
      .catch(() => {
        // Selhání celého přehledu se chová jako prázdné dlaždice, ne jako
        // bílá stránka. Každá dlaždice si chybu hlásí sama.
        if (!cancelled) {
          setPayload({ period_days: period, computed_at: new Date().toISOString(), tiles: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (!payload)
    return (
      <div
        aria-busy="true"
        className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-surface-muted"
      />
    );

  /**
   * Kolik kampaní stojí mimo míry, protože u nich neznáme doručenost.
   *
   * Dlaždice ho ukazuje MÍSTO procenta, ne vedle něj. Server míru u takové
   * kampaně vůbec nespočítá (viz `dashboard/read.ts`), protože jmenovatel by
   * byl odhad; obrazovka na to musí odpovědět větou, ne prázdným místem.
   * Bez ní tu stálo „Otevřelo 185,7 %", což je součet otevření dělený počtem
   * odeslaných zpráv, tedy číslo bez významu.
   */
  const dataOf = (tile: Tile | undefined): Record<string, unknown> | null =>
    tile?.status === 'ok' ? tile.data : null;
  const unknownOf = (tile: Tile | undefined): number =>
    Number((dataOf(tile)?.unknown as { campaigns?: number } | undefined)?.campaigns ?? 0);
  /** Změna proti minulému období. `null` znamená „není s čím porovnat". */
  const deltaOf = (tile: Tile | undefined): number | null => {
    const value = dataOf(tile)?.delta;
    return typeof value === 'number' ? value : null;
  };

  const running = payload.tiles.running;
  const clicks = payload.tiles.click_rate;
  const opens = payload.tiles.open_rate;
  const problems = payload.tiles.problems;
  const sent = payload.tiles.sent;
  const web = payload.tiles.web_active;
  const recent = payload.tiles.recent_campaigns;

  const basePath = `/w/${workspaceSlug}`;
  const rangeLabel = t(`dashboard.period${period}`);
  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 1 });
  const deltaLabel = t('dashboard.deltaSincePrevious');

  const recentItems = (dataOf(recent)?.items ?? []) as Array<
    RecentCampaignRow & { startedAt?: string | null }
  >;
  /** Poslední odeslaná kampaň období. Seznam chodí seřazený od nejnovější. */
  const lastStartedAt = recentItems.find((item) => Boolean(item.startedAt))?.startedAt ?? null;

  return (
    <>
      <PageHeader
        title={t('dashboard.heading')}
        meta={t('dashboard.rangeMeta', {
          range: rangeLabel,
          at: format.dateTime(new Date(payload.computed_at), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        })}
        actions={
          // Obě akce jsou ODKAZY, ne tlačítka s `router.push`: vedou na jinou
          // obrazovku, takže se musí dát otevřít prostředním tlačítkem myši
          // i s Cmd. Vzhled tlačítka dodá `asChild`.
          //
          // Komu na akci chybí oprávnění, ten ji vidí dál, jen s vysvětlením,
          // koho požádat. Odkaz by ho pustil na obrazovku, která ho stejně
          // odmítne, a to už je dneska: obě cílové stránky oprávnění samy
          // nekontrolují, takže prohlížející doklikal až k odmítnutému uložení.
          <>
            {canImportContacts ? (
              <Button asChild>
                <Link href={`${basePath}/contacts/import`}>{t('dashboard.importContacts')}</Link>
              </Button>
            ) : (
              <ActionWithoutPermission
                label={t('dashboard.importContacts')}
                reason={t('dashboard.importForbidden')}
                testId="dashboard-import-forbidden"
              />
            )}
            {canCreateCampaign ? (
              <Button asChild variant="primary">
                <Link href={`${basePath}/campaigns/new`}>
                  {t('dashboard.newCampaign')}
                  <ArrowRight aria-hidden className="icon-sm" />
                </Link>
              </Button>
            ) : (
              <ActionWithoutPermission
                label={t('dashboard.newCampaign')}
                reason={t('dashboard.newCampaignForbidden')}
                testId="dashboard-new-campaign-forbidden"
              />
            )}
          </>
        }
      >
        <RangeSwitch
          label={t('dashboard.periodLabel')}
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((value) => ({
            value,
            label: t(`dashboard.period${value}`),
          }))}
        />
      </PageHeader>

      {running?.status === 'ok' && running.data.campaign ? (
        <Card
          as="div"
          tone="muted"
          padding="sm"
          gap="none"
          role="status"
          className="mb-[var(--spacing-gutter)] flex-row flex-wrap items-center gap-[var(--spacing-inline)]"
        >
          <span className="text-ui text-text">
            {t('dashboard.running', running.data.campaign as Record<string, string | number>)}
          </span>
          <Link
            className="text-ui"
            href={`${basePath}/campaigns/${(running.data.campaign as { campaignId: string }).campaignId}/report`}
          >
            {t('dashboard.runningAction')}
          </Link>
        </Card>
      ) : null}

      <div className="mb-[var(--spacing-gutter)] grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-[var(--spacing-gutter)]">
        <StatTile
          label={t('dashboard.sent')}
          icon={<Send aria-hidden className="icon-md" />}
          iconTone="bg-accent-surface text-warning-text"
          footer={
            <span className="font-mono text-meta text-text-muted">
              {t('dashboard.sentCampaigns', {
                count: recentItems.length,
                date: lastStartedAt
                  ? format.dateTime(new Date(lastStartedAt), { day: 'numeric', month: 'numeric' })
                  : '',
              })}
            </span>
          }
        >
          {sent?.status === 'ok' ? (
            <StatValue>{format.number(Number(sent.data.value))}</StatValue>
          ) : (
            <p role="alert" className="text-ui text-text-muted">
              {t('dashboard.tileError')}
            </p>
          )}
          {deltaOf(sent) !== null ? (
            <StatDelta
              value={deltaOf(sent) ?? 0}
              label={deltaLabel}
              format={percent}
              muted="text-text-muted"
            />
          ) : null}
        </StatTile>

        <StatTile
          label={t('dashboard.opened')}
          icon={<MailOpen aria-hidden className="icon-md" />}
          iconTone="bg-success-surface text-success-text"
          {...(typeof dataOf(opens)?.machineShare === 'number'
            ? {
                footer: (
                  <span className="font-mono text-meta text-text-muted">
                    {t('dashboard.openedMachine', {
                      share: format.number(Number(dataOf(opens)?.machineShare ?? 0), {
                        style: 'percent',
                        maximumFractionDigits: 0,
                      }),
                    })}
                  </span>
                ),
              }
            : {})}
        >
          {opens?.status === 'ok' && typeof opens.data.rate === 'number' ? (
            <>
              <StatValue>
                {format.number(opens.data.rate, { style: 'percent', maximumFractionDigits: 1 })}
              </StatValue>
              {deltaOf(opens) !== null ? (
                <StatDelta
                  value={deltaOf(opens) ?? 0}
                  label={deltaLabel}
                  format={percent}
                  muted="text-text-muted"
                />
              ) : null}
            </>
          ) : unknownOf(opens) > 0 ? (
            <>
              <StatValue>
                <span data-testid="opens-absolute">
                  {t('dashboard.openedAbsolute', { count: Number(dataOf(opens)?.opens ?? 0) })}
                </span>
              </StatValue>
              <p className="text-meta text-text-muted">
                {t('dashboard.rateUnknown', { count: unknownOf(opens) })}
              </p>
            </>
          ) : (
            <p className="text-ui text-text-muted">{t('dashboard.emptyNoCampaigns')}</p>
          )}
        </StatTile>

        {/* Proklik je hlavní číslo obrazovky, proto jediná zvýrazněná dlaždice. */}
        <StatTile
          label={t('dashboard.clicked')}
          tone="highlight"
          icon={<MousePointerClick aria-hidden className="icon-md" />}
          iconTone="bg-panel text-primary"
          footer={<span className="text-meta text-warning-text">{t('dashboard.clickedHint')}</span>}
        >
          {clicks?.status === 'error' ? (
            <p role="alert" className="text-ui text-warning-text">
              {t('dashboard.tileError')}
            </p>
          ) : clicks?.status === 'ok' && typeof clicks.data.rate === 'number' ? (
            <>
              <StatValue>
                {format.number(clicks.data.rate, { style: 'percent', maximumFractionDigits: 1 })}
              </StatValue>
              {deltaOf(clicks) !== null ? (
                <StatDelta
                  value={deltaOf(clicks) ?? 0}
                  label={deltaLabel}
                  format={percent}
                  muted="text-warning-text"
                />
              ) : null}
            </>
          ) : unknownOf(clicks) > 0 ? (
            <>
              <StatValue>
                <span data-testid="clicks-absolute">
                  {t('dashboard.clickedAbsolute', { count: Number(dataOf(clicks)?.clicks ?? 0) })}
                </span>
              </StatValue>
              <p className="text-meta text-warning-text">
                {t('dashboard.rateUnknown', { count: unknownOf(clicks) })}
              </p>
            </>
          ) : (
            <p className="text-ui text-warning-text">{t('dashboard.emptyNoCampaigns')}</p>
          )}
        </StatTile>

        <StatTile
          label={t('dashboard.problems')}
          icon={<TriangleAlert aria-hidden className="icon-md" />}
          iconTone="bg-surface-muted text-danger-text"
          footer={
            <Link href={`${basePath}/settings/sending`} className="text-meta">
              {t('dashboard.problemsAction')}
            </Link>
          }
        >
          {problems?.status === 'ok' ? (
            problems.data.level === 'unknown' ? (
              <>
                <p
                  data-testid="problems-unknown"
                  className="text-callout leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] font-semibold text-text-muted"
                >
                  {t('dashboard.problemsUnknown')}
                </p>
                <p className="text-meta text-text-muted">{t('dashboard.problemsUnknownHint')}</p>
              </>
            ) : (
              <p className="text-callout leading-[var(--leading-heading)] tracking-[var(--tracking-heading)] font-semibold text-text">
                {problems.data.level === 'ok'
                  ? t('dashboard.problemsOk')
                  : t('dashboard.problemsBad')}
              </p>
            )
          ) : (
            <p role="alert" className="text-ui text-text-muted">
              {t('dashboard.tileError')}
            </p>
          )}
        </StatTile>
      </div>

      <div className="mb-[var(--spacing-gutter)] grid grid-cols-12 gap-[var(--spacing-gutter)]">
        <ClicksTrendCard
          points={recentItems.map((item) => ({
            campaignId: item.campaignId,
            startedAt: item.startedAt ?? null,
            clicks: Number(item.clicks ?? 0),
          }))}
          rangeLabel={t('dashboard.rangeWords', { range: rangeLabel })}
          statsHref={`${basePath}/stats/campaigns`}
        />

        <WebActiveCard
          contacts={Number(dataOf(web)?.contacts ?? 0)}
          people={(dataOf(web)?.people ?? []) as WebActivePerson[]}
          computedAt={web?.status === 'ok' ? web.computed_at : payload.computed_at}
          webHref={`${basePath}/stats/web`}
          {...(web?.status === 'ok' ? {} : { error: true })}
        />
      </div>

      <RecentCampaignsCard
        items={recentItems}
        basePath={basePath}
        {...(recent?.status === 'ok' ? {} : { error: true })}
      />

      {slots.providerQuota}
      {slots.deliverabilityWarning}
      {slots.onboardingSteps}
    </>
  );
}
