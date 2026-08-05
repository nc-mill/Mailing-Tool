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
  /**
   * Víme u téhle kampaně, kolik zpráv dorazilo? Server ho posílá jako
   * `deliveredKnown` v dlaždici `recent_campaigns`.
   */
  deliveredKnown?: boolean;
  opens: number;
  opensApple: number;
  clicks: number;
  unsubscribed: number;
};

/**
 * Kampaně, ze kterých se smí kreslit graf měr.
 *
 * VZNIKLO Z POHLEDU NA OBRAZOVKU. Trend ukazoval „Doručeno 100 %" a „Otevřelo
 * 87 %" u kampaní, od jejichž odesílací služby nedorazila ani jedna zpráva
 * o osudu e-mailů. Jmenovatel byl dopočtený („odesláno minus odrazy", jenže
 * odrazy taky neznáme), takže čára v grafu nepopisovala měření, ale výpočet
 * z neznámé veličiny.
 *
 * Kampaň se proto z grafu VYPOUŠTÍ a obrazovka o tom napíše větu. Nakreslit ji
 * v nule by tvrdilo, že nikomu nic nedošlo, což je jiná lež.
 *
 * Chybějící `deliveredKnown` (starší odpověď serveru) se bere jako známé:
 * chování zůstane takové, jaké bylo, místo aby se graf tiše vyprázdnil.
 */
export function withKnownDelivery(campaigns: TrendCampaign[]): TrendCampaign[] {
  return campaigns.filter((campaign) => campaign.deliveredKnown !== false);
}

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
