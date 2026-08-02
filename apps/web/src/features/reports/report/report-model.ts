export type StatsPayload = {
  campaign_id: string;
  name: string;
  subject: string;
  status: string;
  track_opens: boolean;
  track_clicks: boolean;
  delivered_source: 'provider_events' | 'derived_from_sent';
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
  rate: number | null;
  labelKey: string;
  denominatorKey: string;
  hintKey: string | null;
  disabled: boolean;
};

/**
 * Tři hlavní dlaždice podle 8.7.2 části 6, s prokliky na první pozici a největší.
 * Míra otevření mezi nimi schválně není: je o patro níž ve vlastním panelu.
 */
export function headlineTiles(payload: StatsPayload): HeadlineTile[] {
  return [
    {
      key: 'clicked',
      size: 'primary',
      count: payload.counts.clicks_unique_human ?? 0,
      rate: payload.rates.click_rate ?? null,
      labelKey: 'report.clicked.label',
      denominatorKey: 'report.clicked.denominator',
      hintKey: 'report.clicked.hint',
      disabled: !payload.track_clicks,
    },
    {
      key: 'delivered',
      size: 'secondary',
      count: payload.counts.delivered_effective ?? 0,
      rate: safeRatio(payload.counts.delivered_effective, payload.counts.sent),
      labelKey: 'report.delivered.label',
      denominatorKey: 'report.delivered.denominator',
      hintKey: null,
      disabled: false,
    },
    {
      key: 'unsubscribed',
      size: 'secondary',
      count: payload.counts.unsubscribed ?? 0,
      rate: payload.rates.unsubscribe_rate ?? null,
      labelKey: 'report.unsubscribed.label',
      denominatorKey: 'report.unsubscribed.denominator',
      hintKey: null,
      disabled: false,
    },
  ];
}

export type OpensMode = 'verified' | 'all';

export type OpensView = {
  disabled: boolean;
  mode: OpensMode;
  headlineCount: number | null;
  rate: number | null;
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

  if (!payload.track_opens) {
    return {
      disabled: true,
      mode,
      headlineCount: null,
      rate: null,
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
    headlineCount: mode === 'verified' ? breakdown.verified : breakdown.total,
    rate:
      mode === 'verified'
        ? (payload.rates.verified_open_rate ?? null)
        : (payload.rates.open_rate ?? null),
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
