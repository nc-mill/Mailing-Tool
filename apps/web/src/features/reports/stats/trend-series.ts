/**
 * Tvar jedné kampaně tak, jak ji vrací dlaždice `recent_campaigns`
 * z `/api/v1/dashboard`. Pole se jmenují stejně jako v `RecentCampaign`
 * (úkol 22) schválně: kdyby se lišila, graf by počítal podíly z `undefined`
 * a vykreslil samé nuly, aniž by cokoliv spadlo. Hlídá to test v kroku 1.
 */
export type TrendCampaign = {
  campaignId: string;
  name: string;
  startedAt: string;
  sent: number;
  delivered: number;
  deliveredEffective: number;
  opens: number;
  opensApple: number;
  clicks: number;
  unsubscribed: number;
};

export type TrendRow = {
  campaignId: string;
  name: string;
  at: string;
  values: { delivered: number; clicked: number; opened: number; unsubscribed: number };
  machineShare: number;
};

export function trendSeries(_campaigns: TrendCampaign[]) {
  return [
    { key: 'delivered', labelKey: 'stats.seriesDelivered' },
    { key: 'clicked', labelKey: 'stats.seriesClicked' },
    { key: 'opened', labelKey: 'stats.seriesOpened' },
    { key: 'unsubscribed', labelKey: 'stats.seriesUnsubscribed' },
  ];
}

/** Osa Y u měr začíná na nule, proto se pracuje s podíly, ne s absolutními počty. */
export function trendRows(campaigns: TrendCampaign[]): TrendRow[] {
  return [...campaigns]
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      at: campaign.startedAt,
      values: {
        delivered: ratio(campaign.deliveredEffective, campaign.sent),
        // Jmenovatel je deliveredEffective, ne delivered: u SMTP provideru
        // je `delivered` trvale nula a míry by vyšly nulové u každé kampaně.
        clicked: ratio(campaign.clicks, campaign.deliveredEffective),
        opened: ratio(campaign.opens, campaign.deliveredEffective),
        unsubscribed: ratio(campaign.unsubscribed, campaign.deliveredEffective),
      },
      machineShare: ratio(campaign.opensApple, campaign.opens),
    }));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}
