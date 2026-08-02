'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dashboardUrl, fetchJson } from '../api-client';
import { isStale, parsePeriod, type DashboardPeriod, type DashboardSlots } from './dashboard-slots';

type Tile =
  | { status: 'ok'; data: Record<string, unknown>; computed_at: string; stale: boolean }
  | { status: 'error'; code: string };

type DashboardPayload = {
  period_days: number;
  computed_at: string;
  tiles: Record<string, Tile>;
};

export function DashboardGrid({
  workspaceSlug,
  slots = {},
}: {
  workspaceSlug: string;
  slots?: DashboardSlots;
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
    return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-surface-muted" />;

  const running = payload.tiles.running;
  const clicks = payload.tiles.click_rate;
  const opens = payload.tiles.open_rate;
  const problems = payload.tiles.problems;
  const sent = payload.tiles.sent;
  const web = payload.tiles.web_active;
  const recent = payload.tiles.recent_campaigns;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('dashboard.heading')}</h1>

      <div role="group" aria-label={t('dashboard.heading')} className="flex gap-2">
        {([7, 30, 90] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded px-2 py-1 border border-border"
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {t(`dashboard.period${value}`)}
          </button>
        ))}
      </div>

      {running?.status === 'ok' && running.data.campaign ? (
        <p role="status">
          {t('dashboard.running', running.data.campaign as Record<string, string | number>)}{' '}
          <Link
            href={`/w/${workspaceSlug}/campaigns/${(running.data.campaign as { campaignId: string }).campaignId}/report`}
          >
            {t('dashboard.runningAction')}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        {/* Kliklo je vizuálně největší dlaždice. */}
        <section
          aria-labelledby="tile-clicks"
          className="rounded-lg border border-border p-6 sm:col-span-2"
        >
          <h2 id="tile-clicks">{t('dashboard.clicked')}</h2>
          {clicks?.status === 'error' ? (
            <p role="alert">{t('dashboard.tileError')}</p>
          ) : clicks?.status === 'ok' && typeof clicks.data.rate === 'number' ? (
            <p className="text-5xl font-semibold">
              {format.number(clicks.data.rate, { style: 'percent', maximumFractionDigits: 1 })}
            </p>
          ) : (
            <p>{t('dashboard.emptyNoCampaigns')}</p>
          )}
          <p className="text-xs text-text-muted">{t('dashboard.clickedHint')}</p>
        </section>

        <section aria-labelledby="tile-sent" className="rounded-lg border border-border p-4">
          <h2 id="tile-sent">{t('dashboard.sent')}</h2>
          {sent?.status === 'ok' ? (
            <p className="text-3xl">{format.number(Number(sent.data.value))}</p>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>

        <section aria-labelledby="tile-opens" className="rounded-lg border border-border p-4">
          <h2 id="tile-opens">{t('dashboard.opened')}</h2>
          {opens?.status === 'ok' && typeof opens.data.rate === 'number' ? (
            <>
              <p className="text-3xl">
                {format.number(opens.data.rate, { style: 'percent', maximumFractionDigits: 1 })}
              </p>
              <p className="text-xs text-text-muted">
                {t('dashboard.openedMachine', {
                  share: format.number(Number(opens.data.machineShare ?? 0), {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  }),
                })}
              </p>
            </>
          ) : (
            <p>{t('dashboard.emptyNoCampaigns')}</p>
          )}
        </section>

        <section aria-labelledby="tile-problems" className="rounded-lg border border-border p-4">
          <h2 id="tile-problems">{t('dashboard.problems')}</h2>
          {problems?.status === 'ok' ? (
            <p>
              {problems.data.level === 'ok'
                ? t('dashboard.problemsOk')
                : t('dashboard.problemsBad')}
            </p>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>

        <section aria-labelledby="tile-web" className="rounded-lg border border-border p-4">
          <h2 id="tile-web">{t('dashboard.webActive')}</h2>
          {web?.status === 'ok' ? (
            <>
              <p>{t('dashboard.webActiveValue', { count: Number(web.data.contacts) })}</p>
              {isStale(web.computed_at, 300_000, new Date()) ? (
                <p className="text-xs text-text-muted">
                  {t('dashboard.computedAt', {
                    time: format.dateTime(new Date(web.computed_at), { timeStyle: 'short' }),
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>

        <section
          aria-labelledby="tile-recent"
          className="rounded-lg border border-border p-4 sm:col-span-2"
        >
          <h2 id="tile-recent">{t('dashboard.recentCampaigns')}</h2>
          {recent?.status === 'ok' ? (
            <ul>
              {(
                recent.data.items as Array<{
                  campaignId: string;
                  name: string;
                  clickRate: number | null;
                }>
              ).map((item) => (
                <li key={item.campaignId}>
                  <Link href={`/w/${workspaceSlug}/campaigns/${item.campaignId}/report`}>
                    {item.name}
                  </Link>{' '}
                  {item.clickRate === null
                    ? '–'
                    : format.number(item.clickRate, { style: 'percent', maximumFractionDigits: 1 })}
                </li>
              ))}
            </ul>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>
      </div>

      {slots.providerQuota}
      {slots.deliverabilityWarning}
      {slots.onboardingSteps}
    </div>
  );
}
