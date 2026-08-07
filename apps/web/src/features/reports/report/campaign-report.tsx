'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RefreshCw } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { CampaignBreadcrumbs } from '@/features/campaigns/campaign-breadcrumbs';
import {
  campaignLinksUrl,
  campaignProgressUrl,
  campaignStatsUrl,
  campaignSystemLinkClicksUrl,
  fetchJson,
  type ReportsApiError,
} from '../api-client';
import { useLiveStats } from '../live/use-live-stats';
import { RecipientsPanel } from '../recipients/recipients-panel';
import { parseFilter, type RecipientFilter } from '../recipients/recipients-filter';
import { DiagnosticsPanel } from './diagnostics-panel';
import { FollowUpActions } from './follow-up-actions';
import { HeadlineTiles } from './headline-tiles';
import { LinksTable, type LinkRow } from './links-table';
import { OpensPanel } from './opens-panel';
import { ProblemsPanel } from './problems-panel';
import { ProgressChart, type ProgressPoint } from './progress-chart';
import { feedbackGap } from './provider-feedback';
import { reportBanner, statsNotComputed } from './report-banner';
import { SentPreview } from './sent-preview';
import { SystemLinksPanel, type SystemLinkClicks } from './system-links-panel';
import { WebActivityPanel } from './web-activity-panel';
import { mergeLiveSnapshot, type OpensMode, type StatsPayload } from './report-model';

export function CampaignReport({
  workspaceId,
  workspaceSlug,
  campaignId,
}: {
  /*
   * Projekt se sem předává ID i jménem v adrese, protože každé slouží k něčemu
   * jinému: ze jména se skládají odkazy, ID chtějí serverové akce (duplikace
   * kampaně v nabídce dalších kroků). Dopočítat jedno z druhého by znamenalo
   * další dotaz na server v komponentě, která běží v prohlížeči.
   */
  workspaceId: string;
  workspaceSlug: string;
  campaignId: string;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  /*
   * ODCHYLKA OD PLÁNU. Plán četl přepínače přímo z `useSearchParams()`.
   * V praxi se ukázalo, že po `router.replace('?opens=all')` se hodnota
   * z `useSearchParams()` v tomhle stromu neobnoví, takže zaškrtávátko
   * zůstalo viset ve staré poloze a uživatel klikal do prázdna (ověřeno
   * testem v prohlížeči, který na původním znění padal na
   * „Clicking the checkbox did not change its state").
   *
   * Stav se proto drží v komponentě a URL je jeho ODRAZ, ne zdroj. Pravidlo
   * „co jde poslat kolegovi, má URL" tím zůstává v platnosti: adresa se
   * pořád mění a otevření odkazu nastaví výchozí polohu.
   */
  const [mode, setMode] = useState<OpensMode>(
    searchParams.get('opens') === 'all' ? 'all' : 'verified',
  );
  const [granularity, setGranularity] = useState<'5m' | 'hour' | 'day'>(
    (searchParams.get('granularity') ?? '5m') as '5m' | 'hour' | 'day',
  );
  const [recipientsFilter, setRecipientsFilter] = useState<RecipientFilter>(
    parseFilter(searchParams.get('recipients')),
  );

  const [payload, setPayload] = useState<StatsPayload | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [progress, setProgress] = useState<{ points: ProgressPoint[]; compacted: boolean }>({
    points: [],
    compacted: false,
  });
  const [systemLinks, setSystemLinks] = useState<SystemLinkClicks | null>(null);
  const [error, setError] = useState<ReportsApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Čtyři nezávislé zdroje se načítají paralelně, ne za sebou.
    void Promise.allSettled([
      fetchJson<StatsPayload>(campaignStatsUrl(campaignId)),
      fetchJson<{ data: LinkRow[] }>(campaignLinksUrl(campaignId)),
      fetchJson<{ points: ProgressPoint[]; compacted: boolean }>(
        campaignProgressUrl(campaignId, granularity),
      ),
      /*
       * Prokliky na systémové odkazy mají VLASTNÍ dotaz, ne pole v souhrnu.
       * Do `campaign_stats` se záměrně neagregují, takže by verzí souhrnu
       * nehnuly a podmíněný dotaz by vracel zastaralá čísla.
       */
      fetchJson<SystemLinkClicks>(campaignSystemLinkClicksUrl(campaignId)),
    ]).then(([stats, linkResult, progressResult, systemLinkResult]) => {
      if (cancelled) return;
      if (stats.status === 'fulfilled' && stats.value.status === 'ok') setPayload(stats.value.data);
      if (stats.status === 'rejected') setError(stats.reason as ReportsApiError);
      if (linkResult.status === 'fulfilled' && linkResult.value.status === 'ok') {
        setLinks(linkResult.value.data.data);
      }
      if (progressResult.status === 'fulfilled' && progressResult.value.status === 'ok') {
        setProgress(progressResult.value.data);
      }
      if (systemLinkResult.status === 'fulfilled' && systemLinkResult.value.status === 'ok') {
        setSystemLinks(systemLinkResult.value.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, granularity]);

  const live = useLiveStats(campaignId, null, payload?.status);
  const liveSnapshot = live.snapshot;

  useEffect(() => {
    if (!liveSnapshot) return;
    // Sloučení řeší `mergeLiveSnapshot`, protože zpráva ze SSE je plochá,
    // kdežto odpověď dotazování je celý souhrn.
    setPayload((previous) => (previous ? mergeLiveSnapshot(previous, liveSnapshot) : previous));
  }, [liveSnapshot]);

  /** Zapíše volbu do adresy, aby šla poslat kolegovi. Stav drží komponenta. */
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(
      typeof window === 'undefined' ? searchParams.toString() : window.location.search,
    );
    next.set(key, value);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const changeMode = (next: OpensMode) => {
    setMode(next);
    setParam('opens', next);
  };

  const changeGranularity = (next: '5m' | 'hour' | 'day') => {
    setGranularity(next);
    setParam('granularity', next);
  };

  const changeRecipientsFilter = (next: RecipientFilter) => {
    setRecipientsFilter(next);
    setParam('recipients', next);
  };

  if (error) {
    return (
      <Card role="alert" className="border-danger" gap="stack">
        <p className="text-ui text-text">{t('report.states.error')}</p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
            <RefreshCw aria-hidden className="icon-sm" />
            {t('report.states.retry')}
          </Button>
        </div>
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-ui text-accent-text">
            {t('report.diagnostics.heading')}
          </summary>
          <p className="pt-[var(--spacing-inline)] font-mono text-meta text-text-muted">
            {error.code} {error.requestId}
          </p>
        </details>
      </Card>
    );
  }

  if (!payload)
    return (
      <div
        aria-busy="true"
        className="h-64 animate-pulse rounded-[var(--radius-surface)] bg-surface-muted"
      />
    );

  if (payload.status === 'draft') {
    return (
      <Card>
        <p className="text-ui text-text">{t('report.states.draft')}</p>
        <p>
          <a href={`/w/${workspaceSlug}/campaigns/${campaignId}`}>
            {t('report.states.draftAction')}
          </a>
        </p>
      </Card>
    );
  }

  const now = new Date();
  const banner = reportBanner(payload, now);
  /*
   * Chybí zpětná vazba od odesílací služby? Počítá se TADY, protože k tomu
   * je potřeba aktuální čas: mlčení služby je nález až chvíli po dokončení
   * rozesílky, ne během ní. Panel problémů podle toho ukáže buď naměřená
   * čísla, nebo přizná, že údaj nemáme.
   */
  const gap = feedbackGap(payload, now);

  /*
   * Meta řádek pod nadpisem: předmět, kdy to odešlo a kolika lidem. Skládá se
   * z toho, co v souhrnu doopravdy je; chybějící údaj se vynechá, ne aby se
   * do řádku dostalo prázdné místo za tečkou.
   */
  const sentAt = payload.finished_at ?? payload.started_at;
  const meta = [
    `${t('report.subjectLabel')}: ${payload.subject}`,
    sentAt === null ? null : t('report.sentAt', { at: format.dateTime(new Date(sentAt), 'short') }),
    payload.counts.sent === undefined
      ? null
      : t('report.recipientCount', { count: payload.counts.sent }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <div className="flex flex-col">
      {/*
       * Hlavička říká, ČÍ report to je. Bez ní se ze seznamu kampaní kliklo na
       * řádek a přistálo se na stránce plné čísel bez jediného slova o tom,
       * která kampaň to je; jméno ani předmět se nikde nevykreslovaly, přestože
       * obojí v odpovědi `/stats` je.
       *
       * Spodní mezeru si hlavička píše sama, proto obal mezeru nemá a zbytek
       * reportu ji má ve vlastním sloupci.
       */}
      <PageHeader
        title={payload.name}
        eyebrow={t('report.title')}
        meta={meta}
        breadcrumbs={
          <CampaignBreadcrumbs basePath={`/w/${workspaceSlug}`} campaignName={payload.name} />
        }
        actions={
          <>
            {/*
             * Cesta zpátky na průběh. Report a průběh jsou dvě strany téže
             * kampaně a musí jít přejít OBĚMA směry: z průběhu na výsledky vede
             * odkaz z `ProgressScreen`, odsud se dá zpátky podívat, jak
             * rozesílka běžela.
             */}
            <a
              href={`/w/${workspaceSlug}/campaigns/${campaignId}/progress`}
              className="text-ui"
              data-testid="report-to-progress"
            >
              {t('report.toProgress')}
            </a>
            {/*
             * Ruční obnovení patří k číslům, ne na konec stránky za akce.
             * V plánu viselo úplně dole a bez souvislosti vypadalo jako tlačítko
             * k ničemu; tady je v hlavičce vedle stavu, kde dává smysl.
             */}
            <Button variant="secondary" size="sm" onClick={live.refresh}>
              <RefreshCw aria-hidden className="icon-sm" />
              {t('report.states.retry')}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {/*
         * NESPOČÍTANÝ SOUHRN SE PŘIZNÁ NAHOŘE, PŘED VŠEMI ČÍSLY. Netýká se
         * jedné dlaždice, ale celé stránky: dokud souhrn nevznikl, je každá
         * hodnota níž nula z prázdného řádku, ne měření. Naměřeno v prohlížeči
         * na odeslané kampani, kde průběh hlásil tři odeslané zprávy a report
         * samé nuly.
         */}
        {statsNotComputed(payload) ? (
          <Alert tone="warning" role="status" data-testid="stats-not-computed">
            {t('report.states.notComputed')}
          </Alert>
        ) : null}

        {/* Pruh je pruh, ne odstavec: podklad a barevná linka ho oddělí od čísel
          pod ním, jinak splyne s obsahem a uživatel ho přehlédne. */}
        {banner === null ? null : (
          <Alert tone={banner.tone === 'warning' ? 'warning' : 'info'} role="status">
            {t(banner.key, banner.values)}
          </Alert>
        )}

        {/*
         * Výhrady k číslům jedou v JEDNOM tlumeném pruhu, ne každá zvlášť:
         * jsou to poznámky pod čarou k celé stránce a tři barevné bloky za sebou
         * by přebily čísla, kvůli kterým se report otevírá.
         */}
        {live.state.degraded || payload.small_sample ? (
          <Card
            as="div"
            tone="muted"
            padding="none"
            gap="none"
            role="status"
            className="flex-row flex-wrap items-center gap-x-[var(--spacing-stack)] gap-y-1 px-[var(--spacing-row-x)] py-3"
          >
            {live.state.degraded ? (
              <span className="font-mono text-meta text-text-muted">
                {t('report.banner.liveUnavailable')}
              </span>
            ) : null}
            {payload.small_sample ? (
              <span className="font-mono text-meta text-text-muted">
                {t('report.states.smallSample')}
              </span>
            ) : null}
          </Card>
        ) : null}

        {/* testid je tu kvůli testům v prohlížeči: hlavní dlaždice se hledají
          uvnitř tohohle bloku, ne na celé stránce, kde jsou i nadpisy skořápky. */}
        <div data-testid="headline-tiles">
          <HeadlineTiles payload={payload} />
        </div>
        <OpensPanel payload={payload} mode={mode} onModeChange={changeMode} />
        <ProblemsPanel
          payload={payload}
          gap={gap}
          onShowWho={(filter) => changeRecipientsFilter(parseFilter(filter))}
        />
        {/*
         * Patička stojí VEDLE odkazů na obsah, ne pod nimi. Blízko, protože
         * odpovídá na tutéž otázku „kam lidé klikali"; jako vlastní panel,
         * protože se to nesmí sečíst s mírou prokliku.
         */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-[var(--spacing-gutter)]">
          <LinksTable links={links} disabled={!payload.track_clicks} />
          <SystemLinksPanel clicks={systemLinks} />
        </div>
        {/*
         * Graf kreslí JEN ŘADY, KTERÉ SE DOOPRAVDY MĚŘÍ. Bez tohohle příznaku
         * vedle sebe na jedné stránce stálo „Doručeno: Zatím nevíme" a plochá
         * čára Doručeno na nule, tedy dvě opačná tvrzení o téže věci.
         */}
        <ProgressChart
          points={progress.points}
          compacted={progress.compacted}
          granularity={granularity}
          onGranularityChange={changeGranularity}
          measured={{
            delivered: payload.delivered_known,
            opens: payload.track_opens,
            clicks: payload.track_clicks,
          }}
        />
        {/*
         * DOPLNĚK PROTI PLÁNU: panel příjemců je součástí reportu.
         * Plán ho v úkolu 32 vytvořil, ale nikam nenapojil, přestože tlačítko
         * „Zobrazit komu" v panelu problémů nastavuje `?recipients=...`.
         * Bez tohohle řádku by seznam příjemců existoval a nešel otevřít.
         */}
        <RecipientsPanel
          campaignId={campaignId}
          filter={recipientsFilter}
          onFilterChange={changeRecipientsFilter}
          tracking={{ trackOpens: payload.track_opens, trackClicks: payload.track_clicks }}
        />
        {/*
         * Odeslaná podoba patří pod čísla, ne nad ně: report se otevírá kvůli
         * výsledkům a náhled je odpověď na otázku „co přesně lidé viděli",
         * která přichází až po nich. Je jen ke čtení, tlačítko na úpravu nemá.
         */}
        {/*
         * Webová aktivita stojí ZA odkazy a před náhledem odeslané podoby.
         * Je to odpověď na otázku „a co dělali potom", která přichází hned po
         * „kam klikali", takže patří k sobě; má ale vlastní zdroj dat, vlastní
         * pravidlo připsání a vlastní prázdný stav, proto je to vlastní panel.
         */}
        <WebActivityPanel campaignId={campaignId} workspaceSlug={workspaceSlug} />
        <SentPreview campaignId={campaignId} />
        <DiagnosticsPanel payload={payload} />
        <FollowUpActions
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          campaignId={campaignId}
        />
      </div>
    </div>
  );
}
