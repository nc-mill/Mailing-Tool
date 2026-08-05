'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { campaignWebActivityUrl, fetchJson } from '../api-client';

export type CampaignWebActivityPayload = {
  campaign_id: string;
  started_at: string | null;
  window_hours: number;
  clicked_contacts: number;
  visitor_contacts: number;
  page_views: number;
  other_events: number;
  sessions: number;
  last_visit_at: string | null;
  pages: Array<{ path: string; views: number; visitors: number }>;
  events: Array<{ name: string; count: number; visitors: number }>;
  visitors: Array<{
    contact_id: string;
    email: string;
    name: string;
    page_views: number;
    events: number;
    first_seen_at: string;
    last_seen_at: string;
  }>;
};

/**
 * Co lidé po téhle kampani dělali na webu.
 *
 * PROČ TO V REPORTU DOSUD NEBYLO. Měření webu se dodělalo dřív než jeho
 * zobrazení, takže data v `web_events` ležela a report o nich mlčel. Otázka
 * „přinesla ta kampaň někoho na web" je přitom jediný důvod, proč se web měří.
 *
 * CO SE UKAZUJE A CO NE. Vazba „tahle návštěva vznikla z tohohle e-mailu"
 * v datech neexistuje; existuje proklik s číslem kampaně a existuje návštěva
 * téhož člověka. Panel je proto spojuje časem a NAPÍŠE TO. Odhadovat víc
 * (například připisovat kampani každou návštěvu jejího příjemce) by vyrobilo
 * čísla, která vypadají chytře a neznamenají nic.
 */
export function WebActivityPanel({
  campaignId,
  workspaceSlug,
}: {
  campaignId: string;
  workspaceSlug: string;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [payload, setPayload] = useState<CampaignWebActivityPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<CampaignWebActivityPayload>(campaignWebActivityUrl(campaignId))
      .then((result) => {
        if (!cancelled && result.status === 'ok') setPayload(result.data);
      })
      // Webová aktivita je doplněk reportu. Když se nenačte, zbytek stránky
      // musí žít dál, proto se chyba nepromítá do stavu celého reportu.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (payload === null) return null;

  const heading = (
    <h2 id="web-activity-heading" className="text-base font-semibold">
      {t('web.campaign.heading')}
    </h2>
  );

  const frame = (children: React.ReactNode) => (
    <section
      data-testid="web-activity-panel"
      aria-labelledby="web-activity-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      {heading}
      {children}
    </section>
  );

  if (payload.started_at === null) {
    return frame(<p className="mt-2 text-sm text-text-muted">{t('web.campaign.notSent')}</p>);
  }

  if (payload.clicked_contacts === 0) {
    return frame(<p className="mt-2 text-sm text-text-muted">{t('web.campaign.emptyNoClicks')}</p>);
  }

  if (payload.visitor_contacts === 0) {
    return frame(
      <>
        <p className="mt-2 text-sm">
          {t('web.campaign.clicked', { count: payload.clicked_contacts })}
        </p>
        <p className="mt-2 text-sm text-text-muted">{t('web.campaign.emptyNoVisits')}</p>
        <p className="mt-2 text-sm">
          <Link href={`/w/${workspaceSlug}/settings/tracking`} className="underline">
            {t('web.campaign.emptyNoVisitsAction')}
          </Link>
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {t('web.campaign.rule', { hours: payload.window_hours })}
        </p>
      </>,
    );
  }

  return frame(
    <>
      {/* Nejdřív věta, pak tabulky. Uživatel není analytik a čte odshora. */}
      <p className="mt-2 text-sm" data-testid="web-activity-summary">
        {t('web.campaign.clicked', { count: payload.clicked_contacts })}{' '}
        {t('web.campaign.visited', { count: payload.visitor_contacts })}{' '}
        {t('web.campaign.browsed', {
          pages: payload.page_views,
          events: payload.other_events,
        })}
      </p>
      {payload.last_visit_at === null ? null : (
        <p className="mt-1 text-sm text-text-muted">
          {t('web.campaign.lastVisit', {
            when: format.dateTime(new Date(payload.last_visit_at), {
              dateStyle: 'short',
              timeStyle: 'short',
            }),
          })}
        </p>
      )}
      <p className="mt-2 text-xs text-text-muted">
        {t('web.campaign.rule', { hours: payload.window_hours })}
      </p>

      {payload.pages.length === 0 ? null : (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('web.campaign.pagesHeading')}</h3>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th scope="col" className="px-2 py-1">
                  {t('web.campaign.pagesColumnPath')}
                </th>
                <th scope="col" className="px-2 py-1 text-right">
                  {t('web.campaign.pagesColumnViews')}
                </th>
                <th scope="col" className="px-2 py-1 text-right">
                  {t('web.campaign.pagesColumnVisitors')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payload.pages.map((page) => (
                <tr key={page.path}>
                  <td className="px-2 py-1 break-all">{page.path}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{format.number(page.views)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {format.number(page.visitors)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payload.events.length === 0 ? null : (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('web.campaign.eventsHeading')}</h3>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th scope="col" className="px-2 py-1">
                  {t('web.campaign.eventsColumnName')}
                </th>
                <th scope="col" className="px-2 py-1 text-right">
                  {t('web.campaign.eventsColumnCount')}
                </th>
                <th scope="col" className="px-2 py-1 text-right">
                  {t('web.campaign.pagesColumnVisitors')}
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
        </div>
      )}

      {payload.visitors.length === 0 ? null : (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('web.campaign.visitorsHeading')}</h3>
          <ul className="mt-1 text-sm">
            {payload.visitors.map((visitor) => (
              <li key={visitor.contact_id} className="flex flex-wrap gap-x-2">
                {/*
                 * Jméno vede na kontakt, ne na nic. Odsud se dá skočit do jeho
                 * časové osy a podívat se na celou návštěvu krok po kroku,
                 * což je otázka, která přijde hned po „kdo přišel".
                 */}
                <Link href={`/w/${workspaceSlug}/contacts/${visitor.contact_id}`}>
                  {visitor.name === '' ? visitor.email : visitor.name}
                </Link>
                <span className="text-text-muted">
                  {t('web.campaign.visitorsPages', { count: visitor.page_views })},{' '}
                  {format.dateTime(new Date(visitor.last_seen_at), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>,
  );
}
