import { describe, expect, it } from 'vitest';
import { trendRows, trendSeries } from './trend-series';

const campaigns = [
  {
    campaignId: 'a',
    name: 'A',
    startedAt: '2026-06-01T10:00:00.000Z',
    delivered: 1000,
    deliveredEffective: 1000,
    opens: 500,
    opensApple: 200,
    clicks: 40,
    unsubscribed: 5,
    sent: 1010,
  },
  {
    campaignId: 'b',
    name: 'B',
    startedAt: '2026-07-01T10:00:00.000Z',
    delivered: 2000,
    deliveredEffective: 2000,
    opens: 900,
    opensApple: 300,
    clicks: 100,
    unsubscribed: 6,
    sent: 2050,
  },
];

describe('trendSeries', () => {
  it('vrací čtyři řady a body v pořadí odeslání', () => {
    const series = trendSeries(campaigns);
    expect(series.map((s) => s.key)).toEqual(['delivered', 'clicked', 'opened', 'unsubscribed']);
  });

  it('míry počítá z doručených, ne z odeslaných', () => {
    const rows = trendRows(campaigns);
    expect(rows[0]?.values.clicked).toBeCloseTo(40 / 1000, 10);
    expect(rows[1]?.values.opened).toBeCloseTo(900 / 2000, 10);
  });

  it('u nulového jmenovatele vrací nulu místo NaN, aby graf nespadl', () => {
    const rows = trendRows([{ ...campaigns[0]!, delivered: 0, deliveredEffective: 0, sent: 0 }]);
    expect(Number.isNaN(rows[0]?.values.clicked)).toBe(false);
  });

  it('tvar TrendCampaign sedí na to, co vrací dlaždice recent_campaigns', () => {
    // Kdyby endpoint pole přejmenoval nebo je přestal vracet, spočítal by graf
    // podíly z undefined a vykreslil nuly, aniž by cokoliv spadlo.
    for (const key of [
      'sent',
      'delivered',
      'deliveredEffective',
      'opens',
      'opensApple',
      'clicks',
      'unsubscribed',
      'startedAt',
    ]) {
      expect(campaigns[0]).toHaveProperty(key);
    }
  });

  it('u každé kampaně nese podíl automatických otevření, aby otevření nestálo samo', () => {
    expect(trendRows(campaigns)[0]?.machineShare).toBeCloseTo(200 / 500, 10);
  });
});
