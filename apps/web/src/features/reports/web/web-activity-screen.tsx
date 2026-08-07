'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardFooter, CardHeader } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { cn } from '@mlain/ui/lib/cn';
import { ExternalLink, FileText, UserRound, Users, Zap } from '@mlain/ui/icons';
import { fetchJson, webActivityUrl } from '../api-client';
import { PeriodSwitch } from '../stats/period-switch';

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
 * Hlavička sloupce tabulky: mono verzálky na papíru, jako v návrhu. Odsazení
 * zprava drží sloupce od sebe; bez něj se pravý okraj čísel dotýkal popisku
 * dalšího sloupce a v prohlížeči z toho vzniklo „STRÁNKYVSTOUPIL NA".
 */
const TH =
  'meta-caps py-[var(--spacing-inline)] pr-[var(--spacing-stack)] text-text-muted last:pr-0';
/** Buňka řádku. Svislý okraj je `--spacing-row-y`, jako v tabulkách aplikace. */
const TD = 'py-[var(--spacing-row-y)] pr-[var(--spacing-stack)] align-top last:pr-0';

/**
 * Dlaždice s číslem. NENÍ to komponenta katalogu (kapitola 4 základu designu):
 * skládá se z `Card`, mono verzálek a velkého čísla na místě. Tahle je dlaždice
 * WEBU: nemá rozdíl proti minulému období, protože ten server pro web nepočítá,
 * a vymyslet si ho by znamenalo napsat číslo, které nikdo neměřil.
 */
function Tile({
  label,
  icon,
  iconTone,
  footer,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  iconTone: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    <Card padding="md" aria-labelledby={labelId}>
      <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
        <h2 id={labelId} className="meta-caps text-text-muted">
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
      <p className="text-display leading-[var(--leading-number)] font-semibold tracking-[var(--tracking-number)] text-text">
        {children}
      </p>
      {footer ? (
        <CardFooter>
          <span className="text-meta text-text-muted">{footer}</span>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/**
 * Iniciály návštěvníka. Ozdoba řádku, ne informace, takže ji odečítač
 * obrazovky přeskočí; jméno stojí vedle ní.
 */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word.charAt(0).toLocaleUpperCase('cs')).join('') || '?';
}

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
 *
 * VZHLED JE ODVOZENÝ Z PŘEHLEDU (`Mlain Mailer - Přehled.dc.html`): přepínač
 * období v hlavičce, řada dlaždic s čísly, pod nimi karty s obsahem. Panel
 * „Na webu právě teď" z návrhu je předobraz zdejšího seznamu návštěv i těch
 * iniciál v řádku.
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

  const header = (
    <PageHeader title={t('web.overview.heading')} description={t('web.overview.question')}>
      <PeriodSwitch
        label={t('dashboard.periodLabel')}
        value={period}
        onChange={setPeriod}
        options={WEB_PERIODS.map((value) => ({
          value,
          label: t(`web.overview.period${value}`),
        }))}
      />
    </PageHeader>
  );

  if (failed) {
    return (
      <>
        {header}
        <Card tone="muted" padding="sm" role="alert">
          <p className="text-ui text-text">{t('web.overview.error')}</p>
        </Card>
      </>
    );
  }

  if (payload === null) {
    return (
      <>
        {header}
        <div
          aria-busy="true"
          aria-label={t('web.overview.loading')}
          className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-surface-muted"
        />
      </>
    );
  }

  const nothingInPeriod =
    payload.known_contacts === 0 &&
    payload.anonymous_visitors === 0 &&
    payload.page_views === 0 &&
    payload.other_events === 0;

  if (nothingInPeriod) {
    /*
     * Dva různé prázdné stavy, protože se řeší dvěma různými věcmi.
     * „Nikdy nic nedorazilo" je nejspíš nenasazená měřicí značka a patří
     * k němu cesta do nastavení; „za tohle období nic" je normální provoz
     * a stačí u něj říct, kdy naposled někdo přišel.
     */
    return (
      <div data-testid="web-activity-screen">
        {header}
        <Card>
          <CardHeader title={t('web.overview.visitsHeading')} />
          {payload.last_event_at === null ? (
            <>
              <p className="text-ui text-text-muted" data-testid="web-empty-never">
                {t('web.overview.emptyNever')}
              </p>
              <CardFooter>
                <Link href={`/w/${workspaceSlug}/settings/tracking`} className="text-ui">
                  {t('web.overview.emptyNeverAction')}
                </Link>
              </CardFooter>
            </>
          ) : (
            <p className="text-ui text-text-muted" data-testid="web-empty-period">
              {t('web.overview.emptyPeriod', {
                when: format.dateTime(new Date(payload.last_event_at), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="web-activity-screen">
      {header}

      <div className="mb-[var(--spacing-gutter)] grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-[var(--spacing-gutter)]">
        <Tile
          label={t('web.overview.tileKnown')}
          icon={<Users aria-hidden className="icon-md" />}
          iconTone="bg-success-surface text-success-text"
        >
          {format.number(payload.known_contacts)}
        </Tile>
        <Tile
          label={t('web.overview.tileAnonymous')}
          icon={<UserRound aria-hidden className="icon-md" />}
          iconTone="bg-surface-muted text-text-muted"
        >
          {format.number(payload.anonymous_visitors)}
        </Tile>
        <Tile
          label={t('web.overview.tilePages')}
          icon={<FileText aria-hidden className="icon-md" />}
          iconTone="bg-accent-surface text-warning-text"
        >
          {format.number(payload.page_views)}
        </Tile>
        <Tile
          label={t('web.overview.tileEvents')}
          icon={<Zap aria-hidden className="icon-md" />}
          iconTone="bg-panel text-primary"
        >
          {format.number(payload.other_events)}
        </Tile>
      </div>

      {/*
        Věta k číslům nad ní. Dlaždice říkají KOLIK, tenhle pruh říká, co to
        znamená: neznámý návštěvník není chyba měření, je to prohlížeč, u kterého
        ještě nevíme, komu patří.
      */}
      <Card
        as="div"
        tone="muted"
        padding="sm"
        gap="none"
        className="mb-[var(--spacing-gutter)] flex-col gap-[var(--spacing-hairline)]"
      >
        <p className="text-ui text-text" data-testid="web-summary">
          {t('web.overview.summaryKnown', { count: payload.known_contacts })}{' '}
          {t('web.overview.summaryAnonymous', { count: payload.anonymous_visitors })}
        </p>
        <p className="text-meta text-text-muted">{t('web.overview.anonymousExplained')}</p>
      </Card>

      <div className="mb-[var(--spacing-gutter)] grid grid-cols-12 gap-[var(--spacing-gutter)]">
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader
            title={t('web.overview.visitsHeading')}
            meta={t(`web.overview.period${period}`)}
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t('web.overview.visitsHeading')}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TH}>
                    {t('web.overview.visitsColumnWho')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('web.overview.visitsColumnWhen')}
                  </th>
                  <th scope="col" className={cn(TH, 'text-right')}>
                    {t('web.overview.visitsColumnPages')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('web.overview.visitsColumnEntry')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('web.overview.visitsColumnFrom')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payload.visits.map((visit, index) => (
                  <tr
                    key={`${visit.started_at}-${visit.contact_id ?? 'anon'}-${visit.entry_path}`}
                    className={cn(
                      index < payload.visits.length - 1 ? 'border-b border-border' : '',
                    )}
                  >
                    <th scope="row" className={TD}>
                      {visit.contact_id === null ? (
                        <span className="text-ui font-normal text-text-muted">
                          {t('web.overview.visitsAnonymous')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-[var(--spacing-inline)]">
                          <span
                            aria-hidden
                            className="inline-flex size-[var(--size-mark)] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-muted font-mono text-label text-text-muted"
                          >
                            {initialsOf(visit.name ?? visit.email ?? '?')}
                          </span>
                          <Link
                            href={`/w/${workspaceSlug}/contacts/${visit.contact_id}`}
                            className="truncate text-ui font-semibold text-text no-underline hover:underline"
                          >
                            {visit.name ?? visit.email ?? visit.contact_id}
                          </Link>
                        </span>
                      )}
                    </th>
                    <td className={cn(TD, 'font-mono text-meta whitespace-nowrap text-text-muted')}>
                      {format.dateTime(new Date(visit.ended_at), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td
                      className={cn(
                        TD,
                        'text-right font-mono text-meta whitespace-nowrap text-text',
                      )}
                    >
                      {format.number(visit.page_views)}
                    </td>
                    <td className={cn(TD, 'font-mono text-meta break-all text-text')}>
                      {visit.entry_path ?? '–'}
                    </td>
                    <td className={cn(TD, 'font-mono text-meta break-all text-text-muted')}>
                      {visit.referrer_host ?? t('web.overview.visitsDirect')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 self-start lg:col-span-4">
          <CardHeader
            title={t('web.overview.referrersHeading')}
            meta={t('web.overview.referrersColumnVisits')}
          />
          {payload.referrers.length === 0 ? (
            <p className="text-ui text-text-muted">{t('web.overview.referrersEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-[var(--spacing-stack)]">
              {payload.referrers.map((referrer) => (
                <li
                  key={referrer.host}
                  className="flex items-center gap-[var(--spacing-inline)] border-b border-border pb-[var(--spacing-stack)] last:border-b-0 last:pb-0"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-[var(--size-mark)] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-muted text-text-muted"
                  >
                    <ExternalLink className="icon-sm" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ui text-text">{referrer.host}</span>
                  <span className="font-mono text-meta text-text-muted">
                    {format.number(referrer.visits)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-[var(--spacing-gutter)]">
        <Card>
          <CardHeader title={t('web.overview.pagesHeading')} />
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{t('web.overview.pagesHeading')}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={TH}>
                  {t('web.overview.pagesColumnPath')}
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  {t('web.overview.pagesColumnViews')}
                </th>
                <th scope="col" className={cn(TH, 'text-right')}>
                  {t('web.overview.pagesColumnVisitors')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payload.pages.map((page, index) => (
                <tr
                  key={page.path}
                  className={cn(index < payload.pages.length - 1 ? 'border-b border-border' : '')}
                >
                  <th
                    scope="row"
                    className={cn(TD, 'font-mono text-meta break-all font-normal text-text')}
                  >
                    {page.path}
                  </th>
                  <td
                    className={cn(TD, 'text-right font-mono text-meta whitespace-nowrap text-text')}
                  >
                    {format.number(page.views)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      'text-right font-mono text-meta whitespace-nowrap text-text-muted',
                    )}
                  >
                    {format.number(page.visitors)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title={t('web.overview.eventsHeading')} />
          {payload.events.length === 0 ? (
            <p className="text-ui text-text-muted">{t('web.overview.eventsEmpty')}</p>
          ) : (
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t('web.overview.eventsHeading')}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TH}>
                    {t('web.overview.eventsColumnName')}
                  </th>
                  <th scope="col" className={cn(TH, 'text-right')}>
                    {t('web.overview.eventsColumnCount')}
                  </th>
                  <th scope="col" className={cn(TH, 'text-right')}>
                    {t('web.overview.pagesColumnVisitors')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payload.events.map((event, index) => (
                  <tr
                    key={event.name}
                    className={cn(
                      index < payload.events.length - 1 ? 'border-b border-border' : '',
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(TD, 'font-mono text-meta break-all font-normal text-text')}
                    >
                      {event.name}
                    </th>
                    <td
                      className={cn(
                        TD,
                        'text-right font-mono text-meta whitespace-nowrap text-text',
                      )}
                    >
                      {format.number(event.count)}
                    </td>
                    <td
                      className={cn(
                        TD,
                        'text-right font-mono text-meta whitespace-nowrap text-text-muted',
                      )}
                    >
                      {format.number(event.visitors)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
