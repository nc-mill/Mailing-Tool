import { describe, expect, it } from 'vitest';
import { reportBanner, statsNotComputed } from './report-banner';
import { headlineTiles, mergeLiveSnapshot, opensView, type StatsPayload } from './report-model';

const payload: StatsPayload = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  delivered_known: true,
  counts: {
    materialized: 1153,
    sent: 1153,
    skipped: 0,
    failed: 0,
    delivered: 1141,
    delivered_effective: 1141,
    bounced_hard: 8,
    bounced_soft: 4,
    complained: 1,
    unsubscribed: 4,
    opens_total: 1200,
    opens_unique: 832,
    opens_unique_human: 387,
    opens_unique_apple: 411,
    clicks_total: 210,
    clicks_unique: 190,
    clicks_unique_human: 187,
    clicks_scanner: 20,
  },
  rates: {
    open_rate: 0.729,
    machine_open_share: 0.494,
    verified_open_rate: 0.53,
    click_rate: 0.164,
    click_to_open_rate: 0.483,
    bounce_rate: 0.0104,
    complaint_rate: 0.00088,
    unsubscribe_rate: 0.0035,
  },
  open_breakdown: {
    verified: 387,
    machine: 411,
    uncertain: 34,
    total: 832,
    clicked_from_verified: 187,
  },
  predicted_opens: { low_count: 560, high_count: 640, sample_size: 730 },
  small_sample: false,
  audience_built_at: '2026-07-31T14:38:00.000Z',
  started_at: '2026-07-31T14:38:00.000Z',
  finished_at: '2026-07-31T14:52:00.000Z',
  first_event_at: '2026-07-31T14:39:00.000Z',
  last_event_at: '2026-07-31T18:02:00.000Z',
  version: 42,
  updated_at: '2026-07-31T18:02:00.000Z',
};

describe('headlineTiles', () => {
  it('má tři dlaždice a proklik je první a největší', () => {
    const tiles = headlineTiles(payload);
    expect(tiles.map((t) => t.key)).toEqual(['clicked', 'delivered', 'unsubscribed']);
    expect(tiles[0]?.size).toBe('primary');
    expect(tiles[1]?.size).toBe('secondary');
  });

  it('u každé dlaždice uvádí jmenovatel (kritérium 59)', () => {
    for (const tile of headlineTiles(payload)) {
      expect(tile.denominatorKey.length).toBeGreaterThan(0);
    }
  });

  it('míra otevření mezi hlavními dlaždicemi není (kritérium 57)', () => {
    expect(headlineTiles(payload).some((t) => t.key.includes('open'))).toBe(false);
  });

  /*
   * Odkud se doručenost bere, musí být vidět U ČÍSLA. U SMTP účtu žádné
   * potvrzení nechodí a číslo je dopočet; bez téhle věty vypadá stejně
   * důvěryhodně jako potvrzení od odesílací služby.
   */
  it('u doručenosti říká, jestli ji hlásí odesílací služba', () => {
    const provider = headlineTiles(payload).find((t) => t.key === 'delivered');
    expect(provider?.hintKey).toBe('report.delivered.hintProvider');
  });

  it('u odvozené doručenosti říká, že je to dopočet', () => {
    const derived = headlineTiles({ ...payload, delivered_source: 'derived_from_sent' }).find(
      (t) => t.key === 'delivered',
    );
    expect(derived?.hintKey).toBe('report.delivered.hintDerived');
  });
});

describe('opensView', () => {
  it('ve výchozím stavu odečítá automatická otevření a řekne to', () => {
    const view = opensView(payload, 'verified');
    expect(view.headlineCount).toBe(387);
    expect(view.rate).toBe(0.53);
    expect(view.denominatorKey).toBe('report.opens.verifiedRate.denominator');
    expect(view.badgeKey).toBeNull();
  });

  it('po přepnutí ukazuje všechna otevření a nese viditelný odznak', () => {
    const view = opensView(payload, 'all');
    expect(view.headlineCount).toBe(832);
    expect(view.rate).toBe(0.729);
    expect(view.badgeKey).toBe('report.opens.toggle.badgeOff');
  });

  it('obě polohy přepínače uvádějí jmenovatel, ze kterého se míra opravdu počítá', () => {
    // Míra otevření je z DORUČENÝCH v obou polohách, mění se jen to, jestli
    // se od jmenovatele odečítají příjemci s Apple Mailem. Plán tu v poloze
    // „všechna" ukazoval „z odeslaných", což bylo o jinou veličinu vedle.
    expect(opensView(payload, 'verified').denominatorKey).toBe(
      'report.opens.verifiedRate.denominator',
    );
    expect(opensView(payload, 'all').denominatorKey).toBe('report.opens.allRate.denominator');
  });

  it('pruh má tři skupiny a součet podílů je jedna', () => {
    const view = opensView(payload, 'verified');
    expect(view.segments.map((s) => s.key)).toEqual(['verified', 'machine', 'uncertain']);
    expect(view.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  it('u vypnutého měření vrací vysvětlení, ne nulu (kritérium 60)', () => {
    const off = opensView({ ...payload, track_opens: false }, 'verified');
    expect(off.disabled).toBe(true);
    expect(off.headlineCount).toBeNull();
  });

  it('prediktivní otevření podává jako rozsah označený jako odhad', () => {
    const view = opensView(payload, 'verified');
    expect(view.predicted).toEqual({ low: 560, high: 640 });
  });
});

describe('mergeLiveSnapshot', () => {
  it('plochá zpráva ze SSE se propíše do counts, ne vedle nich', () => {
    const merged = mergeLiveSnapshot(payload, {
      version: 43,
      status: 'sending',
      sent: 900,
      delivered: 880,
      opens_unique: 100,
      clicks_unique_human: 50,
    });
    expect(merged.counts.sent).toBe(900);
    expect(merged.counts.clicks_unique_human).toBe(50);
    expect(merged.status).toBe('sending');
    expect(merged.version).toBe(43);
    // Co zpráva nenese, zůstává z posledního úplného načtení.
    expect(merged.counts.bounced_hard).toBe(8);
  });

  it('úplný souhrn z dotazování přepíše stav celý', () => {
    const merged = mergeLiveSnapshot(payload, {
      ...payload,
      version: 44,
      counts: { ...payload.counts, sent: 1200 },
    });
    expect(merged.counts.sent).toBe(1200);
    expect(merged.version).toBe(44);
  });
});

describe('reportBanner', () => {
  it('u odesílané kampaně hlásí průběh', () => {
    const banner = reportBanner(
      {
        ...payload,
        status: 'sending',
        counts: { ...payload.counts, sent: 428, materialized: 1129 },
      },
      new Date('2026-07-31T14:40:00.000Z'),
    );
    expect(banner?.key).toBe('report.banner.progress');
    expect(banner?.values).toMatchObject({ sent: 428, total: 1129 });
  });

  it('do patnácti minut po odeslání upozorní, že se čísla dopočítávají', () => {
    const banner = reportBanner(payload, new Date('2026-07-31T14:59:00.000Z'));
    expect(banner?.key).toBe('report.banner.settling');
  });

  it('po 72 hodinách je report konečný a pruh zmizí', () => {
    expect(reportBanner(payload, new Date('2026-08-04T00:00:00.000Z'))).toBeNull();
  });

  it('u zastavené kampaně vysvětlí, z čeho se počítají procenta', () => {
    const banner = reportBanner(
      { ...payload, status: 'cancelled' },
      new Date('2026-08-04T00:00:00.000Z'),
    );
    expect(banner?.key).toBe('report.banner.stopped');
  });
});

/**
 * Kdyby tenhle blok spadl: report zase tvrdí „Doručeno 0 z odeslaných"
 * u kampaně, která opravdu odeslala, jen se jí ještě nespočítal souhrn.
 * Naměřeno v prohlížeči: `/progress` hlásil 3 odeslané, `/stats` samé nuly.
 */
describe('statsNotComputed', () => {
  it('spočítaný souhrn nehlásí nic', () => {
    expect(statsNotComputed(payload)).toBe(false);
  });

  it('chybějící řádek souhrnu se pozná podle času z počátku epochy', () => {
    expect(statsNotComputed({ ...payload, updated_at: '1970-01-01T00:00:00.000Z' })).toBe(true);
  });
});
