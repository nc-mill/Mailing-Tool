/*
 * Pravidlo „co se má u téhle metriky vůbec ukázat" bydlí v jádře
 * (`metricDisplay`, úkol 7 plánu P14) a tenhle model je jeho jediný volající
 * na straně reportu. Kdyby si ho každá komponenta rozhodovala sama, rozjede se
 * report, dashboard a export, což je přesně to, čemu má jedna funkce zabránit.
 *
 * Podcesta `@mlain/core/reports/metrics/display` je v mapě `exports` balíčku
 * schválně: barrel `@mlain/core/reports` táhne celou doménu včetně SQL, a ta do
 * prohlížeče nesmí. `display.ts` je čistá funkce bez jediného importu.
 */
import { metricDisplay, type MetricDisplay } from '@mlain/core/reports/metrics/display';

export type StatsPayload = {
  campaign_id: string;
  name: string;
  subject: string;
  status: string;
  track_opens: boolean;
  track_clicks: boolean;
  delivered_source: 'provider_events' | 'derived_from_sent';
  /**
   * PLATÍ ČÍSLO DORUČENOSTI, nebo ho jen nemáme? Samostatné pole schválně:
   * třetí hodnota v `delivered_source` by rozbila každého klienta, který nad
   * tím výčtem dělá vyčerpávající rozskok.
   *
   * `false` znamená, že od odesílací služby nedorazila ani jedna událost
   * o osudu zprávy. Ve vývoji je to trvalý stav, protože odběr oznámení se
   * u Amazonu nepotvrdí, když webhook běží na `localhost`.
   */
  delivered_known: boolean;
  counts: Record<string, number>;
  rates: Record<string, number | null>;
  open_breakdown: {
    verified: number;
    machine: number;
    uncertain: number;
    total: number;
    clicked_from_verified: number;
  };
  predicted_opens: { low_count: number; high_count: number; sample_size: number } | null;
  small_sample: boolean;
  audience_built_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  version: number;
  updated_at: string;
};

export type HeadlineTile = {
  key: 'clicked' | 'delivered' | 'unsubscribed';
  size: 'primary' | 'secondary';
  count: number;
  labelKey: string;
  denominatorKey: string;
  hintKey: string | null;
  /**
   * Co dlaždice ukáže. Nahrazuje dřívější dvojici `rate` plus `disabled`, nad
   * kterou si komponenta pravidla dopočítávala sama, a proto u vypnutého
   * měření prokliků vykreslovala velkou nulu.
   */
  display: MetricDisplay;
};

/**
 * Tři hlavní dlaždice podle 8.7.2 části 6, s prokliky na první pozici a největší.
 * Míra otevření mezi nimi schválně není: je o patro níž ve vlastním panelu.
 */
export function headlineTiles(payload: StatsPayload): HeadlineTile[] {
  const clicked = payload.counts.clicks_unique_human ?? 0;
  const delivered = payload.counts.delivered_effective ?? 0;
  const unsubscribed = payload.counts.unsubscribed ?? 0;

  return [
    {
      key: 'clicked',
      size: 'primary',
      count: clicked,
      labelKey: 'report.clicked.label',
      denominatorKey: 'report.clicked.denominator',
      hintKey: 'report.clicked.hint',
      display: metricDisplay({
        rate: payload.rates.click_rate ?? null,
        absolute: clicked,
        enabled: payload.track_clicks,
        smallSample: payload.small_sample,
        disabledReason: 'clicks_disabled',
      }),
    },
    {
      key: 'delivered',
      size: 'secondary',
      count: delivered,
      labelKey: 'report.delivered.label',
      denominatorKey: 'report.delivered.denominator',
      /*
       * ODKUD se doručenost bere, patří K ČÍSLU, ne jen do rozbalené
       * diagnostiky na konci stránky. U SMTP účtu žádné potvrzení o doručení
       * nechodí (`derived_from_sent`) a číslo je dopočet „odesláno minus
       * odmítnutá a selhaná". Bez téhle věty vypadá stejně jako potvrzení
       * od odesílací služby, což je jiná informace.
       */
      hintKey: !payload.delivered_known
        ? 'report.delivered.hintUnknown'
        : payload.delivered_source === 'provider_events'
          ? 'report.delivered.hintProvider'
          : 'report.delivered.hintDerived',
      /*
       * NULA MÍSTO ÚDAJE BYLA TŘETÍ PODOBA TÉŽE ZÁMĚNY, kterou tenhle model
       * hlídá u otevření a prokliků. Doručení se sice vypnout nedá, ale dokud
       * od odesílací služby nedorazila jediná událost o osudu zpráv, není
       * z čeho ho vzít, a „Doručeno 0" pak tvrdí, že rozesílka nedošla nikomu.
       * Přesně tohle viděl zadavatel u kampaně, která normálně dorazila.
       *
       * `enabled` proto nese `delivered_known` a není to obcházení příznaku
       * vypnutého měření: rozdíl mezi „správce měření vypnul" a „služba nám
       * zatím nic neřekla" nese vlastní důvod `delivery_unknown`, protože
       * uživatel s každým z nich udělá něco jiného.
       */
      display: metricDisplay({
        rate: safeRatio(payload.counts.delivered_effective, payload.counts.sent),
        absolute: delivered,
        enabled: payload.delivered_known,
        smallSample: payload.small_sample,
        disabledReason: 'delivery_unknown',
      }),
    },
    {
      key: 'unsubscribed',
      size: 'secondary',
      count: unsubscribed,
      labelKey: 'report.unsubscribed.label',
      denominatorKey: 'report.unsubscribed.denominator',
      hintKey: null,
      display: metricDisplay({
        rate: payload.rates.unsubscribe_rate ?? null,
        absolute: unsubscribed,
        enabled: true,
        smallSample: payload.small_sample,
        disabledReason: 'clicks_disabled',
      }),
    },
  ];
}

export type OpensMode = 'verified' | 'all';

export type OpensView = {
  /**
   * Odvozuje se z `display`, ne z `payload.track_opens` zvlášť. Byla to druhá
   * implementace téhož rozhodnutí vedle `metricDisplay`; zůstává jako pole,
   * protože panel má pro nezměřené otevření celou vlastní podobu, ne jen jiné
   * číslo.
   */
  disabled: boolean;
  mode: OpensMode;
  headlineCount: number | null;
  rate: number | null;
  display: MetricDisplay;
  denominatorKey: string;
  badgeKey: string | null;
  segments: Array<{ key: 'verified' | 'machine' | 'uncertain'; count: number; share: number }>;
  clickedFromVerified: number;
  predicted: { low: number; high: number } | null;
};

/**
 * Přepínač automatických otevření. Výchozí poloha je ta poctivější, tedy
 * s odečtenými automatickými otevřeními; rozhodl to zadavatel. Druhá poloha
 * musí být v reportu viditelně označená, aby si za měsíc nikdo nemyslel,
 * že se dívá na totéž číslo.
 */
export function opensView(payload: StatsPayload, mode: OpensMode): OpensView {
  const breakdown = payload.open_breakdown;
  const sum = breakdown.verified + breakdown.machine + breakdown.uncertain;
  const share = (value: number) => (sum > 0 ? value / sum : 0);

  const headlineCount = mode === 'verified' ? breakdown.verified : breakdown.total;
  const rate =
    mode === 'verified'
      ? (payload.rates.verified_open_rate ?? null)
      : (payload.rates.open_rate ?? null);

  const display = metricDisplay({
    rate,
    absolute: headlineCount,
    enabled: payload.track_opens,
    smallSample: payload.small_sample,
    disabledReason: 'opens_disabled',
  });

  if (display.kind === 'not_measured') {
    return {
      disabled: true,
      mode,
      headlineCount: null,
      rate: null,
      display,
      denominatorKey: 'report.states.trackingOffOpens',
      badgeKey: null,
      segments: [],
      clickedFromVerified: 0,
      predicted: null,
    };
  }

  return {
    disabled: false,
    mode,
    headlineCount,
    rate,
    display,
    /*
     * OPRAVA PROTI PLÁNU. Plán v poloze „všechna otevření" ukazoval jmenovatel
     * `report.delivered.denominator`, což je „z odeslaných". Míra otevření se
     * ale počítá z DORUČENÝCH, ne z odeslaných. Popisek tedy tvrdil něco jiného,
     * než co číslo znamená, a to je přesně ta třída chyby, kterou má kritérium 59
     * („u každého procenta je jmenovatel") vyloučit. Nalezeno pohledem na
     * obrazovku, ne testem: klíč existoval a text se vykreslil.
     */
    denominatorKey:
      mode === 'verified'
        ? 'report.opens.verifiedRate.denominator'
        : 'report.opens.allRate.denominator',
    badgeKey: mode === 'all' ? 'report.opens.toggle.badgeOff' : null,
    segments: [
      { key: 'verified', count: breakdown.verified, share: share(breakdown.verified) },
      { key: 'machine', count: breakdown.machine, share: share(breakdown.machine) },
      { key: 'uncertain', count: breakdown.uncertain, share: share(breakdown.uncertain) },
    ],
    clickedFromVerified: breakdown.clicked_from_verified,
    predicted: payload.predicted_opens
      ? { low: payload.predicted_opens.low_count, high: payload.predicted_opens.high_count }
      : null,
  };
}

/**
 * Sloučení živé zprávy do zobrazeného souhrnu.
 *
 * DOPLNĚK PROTI PLÁNU, BEZ KTERÉHO ŽIVÉ AKTUALIZACE NIC NEDĚLAJÍ. Plán slučoval
 * `{ ...payload, ...snapshot }`. To sedí jen v režimu dotazování, kde snapshot
 * JE celý souhrn. Zpráva ze SSE je ale plochá (`sent`, `delivered`,
 * `opens_unique`, `clicks_unique_human`), takže by se rozlila vedle `counts`
 * a čísla na obrazovce by se nehnula: report by během odesílání tiše zamrzl
 * na hodnotách z prvního načtení a nic by nespadlo.
 */
export function mergeLiveSnapshot(
  payload: StatsPayload,
  snapshot: Record<string, unknown>,
): StatsPayload {
  // Úplný souhrn z dotazování. Přepíše se celý, protože server posílá vždy
  // konzistentní stav, ne přírůstek.
  if (snapshot.counts && typeof snapshot.counts === 'object') {
    return snapshot as unknown as StatsPayload;
  }

  const flat = ['sent', 'delivered', 'opens_unique', 'clicks_unique_human'] as const;
  const counts = { ...payload.counts };
  for (const key of flat) {
    const value = snapshot[key];
    if (typeof value === 'number') counts[key] = value;
  }

  return {
    ...payload,
    counts,
    ...(typeof snapshot.status === 'string' ? { status: snapshot.status } : {}),
    ...(typeof snapshot.version === 'number' ? { version: snapshot.version } : {}),
  };
}

function safeRatio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (!denominator || denominator <= 0) return null;
  return (numerator ?? 0) / denominator;
}
