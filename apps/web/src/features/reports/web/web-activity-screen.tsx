'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchJson, webActivityUrl } from '../api-client';

/** Období, která obrazovka nabízí. Musí se shodovat s výčtem na serveru. */
export const WEB_PERIODS = [1, 7, 30] as const;
export type WebPeriod = (typeof WEB_PERIODS)[number];

export type WebActivityPayload = {
  period_days: number;
  computed_at: string;
  known_contacts: number;
  anonymous_visitors: number;
  page_views: number;
  other_events: number;
  last_event_at: string | null;
  pages: Array<{ path: string; views: number; visitors: number }>;
  events: Array<{ name: string; count: number; visitors: number }>;
  referrers: Array<{ host: string; visits: number }>;
  visits: Array<{
    contact_id: string | null;
    email: string | null;
    name: string | null;
    started_at: string;
    ended_at: string;
    page_views: number;
    events: number;
    entry_path: string | null;
    last_path: string | null;
    referrer_host: string | null;
  }>;
};

/**
 * Obrazovka „co se děje na webu".
 *
 * PROČ VZNIKLA. Přehled projektu měl dlaždici „Na webu právě teď: 3 kontakty
 * za 24 h", která nevedla nikam. Tři kontakty samy o sobě neříkají nic:
 * uživatele zajímá KDO to byl, ODKUD přišel a CO si prohlédl. Tohle je cíl
 * té dlaždice a zároveň jediné místo, kde jsou webová data vidět celá.
 *
 * PROČ V SEKCI STATISTIKY A NE V KONTAKTECH. Je to pohled na provoz, ne na
 * jednoho člověka; jednotlivce ukazuje časová osa kontaktu, kam odsud vede
 * odkaz. Adresa `/w/{slug}/stats/web` sedí vedle `/stats/campaigns`, takže
 * sekce má jednu konvenci, ne dvě.
 */
export function WebActivityScreen({
  workspaceSlug,
  initialPeriod = 7,
}: {
  workspaceSlug: string;
  initialPeriod?: WebPeriod;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [period, setPeriod] = useState<WebPeriod>(initialPeriod);
  const [payload, setPayload] = useState<WebActivityPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFailed(false);
    void fetchJson<WebActivityPayload>(webActivityUrl(period), { workspaceId: workspaceSlug })
      .then((result) => {
        if (!cancelled && result.status === 'ok') setPayload(result.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [period, workspaceSlug]);

  const periodSwitch = (
    <div role="group" aria-label={t('web.overview.heading')} className="flex gap-2">
      {WEB_PERIODS.map((value) => (
        <button
          key={value}
          type="button"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded border border-border px-2 py-1"
          aria-pressed={period === value}
          onClick={() => setPeriod(value)}
        >
          {t(`web.overview.period${value}`)}
        </button>
      ))}
    </div>
  );

  const header = (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{t('web.overview.heading')}</h1>
      <p className="text-sm text-text-muted">{t('web.overview.question')}</p>
    </header>
  );

  if (failed) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p role="alert">{t('web.overview.error')}</p>
      </div>
    );
  }

  if (payload === null) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div
          aria-busy="true"
          aria-label={t('web.overview.loading')}
          className="h-64 animate-pulse rounded-lg bg-surface-muted"
        />
      </div>
    );
  }

  const nothingInPeriod =
    payload.known_contacts === 0 &&
    payload.anonymous_visitors === 0 &&
    payload.page_views === 0 &&
    payload.other_events === 0;

  return (
    <div className="flex flex-col gap-6" data-testid="web-activity-screen">
      {header}
      {periodSwitch}

      {nothingInPeriod ? (
        /*
         * Dva různé prázdné stavy, protože se řeší dvěma různými věcmi.
         * „Nikdy nic nedorazilo" je nejspíš nenasazená měřicí značka a patří
         * k němu cesta do nastavení; „za tohle období nic" je normální provoz
         * a stačí u něj říct, kdy naposled někdo přišel.
         */
        <section className="rounded-lg border border-border bg-surface p-6">
          {payload.last_event_at === null ? (
            <>
              <p data-testid="web-empty-never">{t('web.overview.emptyNever')}</p>
              <p className="mt-2">
                <Link href={`/w/${workspaceSlug}/settings/tracking`} className="underline">
                  {t('web.overview.emptyNeverAction')}
                </Link>
              </p>
            </>
          ) : (
            <p data-testid="web-empty-period">
              {t('web.overview.emptyPeriod', {
                when: format.dateTime(new Date(payload.last_event_at), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </p>
          )}
        </section>
      ) : (
        <>
          <section
            aria-labelledby="web-summary-heading"
            className="rounded-lg border border-border bg-surface p-6"
          >
            <h2 id="web-summary-heading" className="sr-only">
              {t('web.overview.heading')}
            </h2>
            <p className="text-lg" data-testid="web-summary">
              {t('web.overview.summaryKnown', { count: payload.known_contacts })}{' '}
              {t('web.overview.summaryAnonymous', { count: payload.anonymous_visitors })}
            </p>
            <p className="mt-2 text-sm">
              {t('web.overview.summaryPages', {
                pages: payload.page_views,
                events: payload.other_events,
              })}
            </p>
            <p className="mt-2 text-xs text-text-muted">{t('web.overview.anonymousExplained')}</p>
          </section>

          <section
            aria-labelledby="web-visits-heading"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 id="web-visits-heading" className="text-base font-semibold">
              {t('web.overview.visitsHeading')}
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted">
                  <th scope="col" className="px-2 py-1">
                    {t('web.overview.visitsColumnWho')}
                  </th>
                  <th scope="col" className="px-2 py-1">
                    {t('web.overview.visitsColumnWhen')}
                  </th>
                  <th scope="col" className="px-2 py-1 text-right">
                    {t('web.overview.visitsColumnPages')}
                  </th>
                  <th scope="col" className="px-2 py-1">
                    {t('web.overview.visitsColumnEntry')}
                  </th>
                  <th scope="col" className="px-2 py-1">
                    {t('web.overview.visitsColumnFrom')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payload.visits.map((visit) => (
                  <tr key={`${visit.started_at}-${visit.contact_id ?? 'anon'}-${visit.entry_path}`}>
                    <td className="px-2 py-1">
                      {visit.contact_id === null ? (
                        <span className="text-text-muted">{t('web.overview.visitsAnonymous')}</span>
                      ) : (
                        <Link href={`/w/${workspaceSlug}/contacts/${visit.contact_id}`}>
                          {visit.name ?? visit.email ?? visit.contact_id}
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {format.dateTime(new Date(visit.ended_at), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {format.number(visit.page_views)}
                    </td>
                    <td className="px-2 py-1 break-all">{visit.entry_path ?? '–'}</td>
                    <td className="px-2 py-1 break-all">
                      {visit.referrer_host ?? t('web.overview.visitsDirect')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            <section
              aria-labelledby="web-pages-heading"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="web-pages-heading" className="text-base font-semibold">
                {t('web.overview.pagesHeading')}
              </h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th scope="col" className="px-2 py-1">
                      {t('web.overview.pagesColumnPath')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('web.overview.pagesColumnViews')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('web.overview.pagesColumnVisitors')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.pages.map((page) => (
                    <tr key={page.path}>
                      <td className="px-2 py-1 break-all">{page.path}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format.number(page.views)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format.number(page.visitors)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section
              aria-labelledby="web-events-heading"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="web-events-heading" className="text-base font-semibold">
                {t('web.overview.eventsHeading')}
              </h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th scope="col" className="px-2 py-1">
                      {t('web.overview.eventsColumnName')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('web.overview.eventsColumnCount')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('web.overview.pagesColumnVisitors')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.events.map((event) => (
                    <tr key={event.name}>
                      <td className="px-2 py-1 break-all">{event.name}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format.number(event.count)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format.number(event.visitors)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {payload.referrers.length === 0 ? null : (
            <section
              aria-labelledby="web-referrers-heading"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="web-referrers-heading" className="text-base font-semibold">
                {t('web.overview.referrersHeading')}
              </h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th scope="col" className="px-2 py-1">
                      {t('web.overview.referrersColumnHost')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('web.overview.referrersColumnVisits')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.referrers.map((referrer) => (
                    <tr key={referrer.host}>
                      <td className="px-2 py-1 break-all">{referrer.host}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {format.number(referrer.visits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
