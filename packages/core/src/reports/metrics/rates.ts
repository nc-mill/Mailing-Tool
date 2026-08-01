import type { StatsCounts } from './counts';

export type DeliveredSource = 'provider_events' | 'derived_from_sent';

export type TrackingFlags = { trackOpens: boolean; trackClicks: boolean };

export type Rates = {
  openRate: number | null;
  machineOpenShare: number | null;
  verifiedOpenRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  unsubscribeRate: number | null;
};

/** Pod tímhle počtem měřitelných příjemců se ověřená míra nezobrazuje (3.11.2). */
export const VERIFIED_OPEN_MIN_DENOMINATOR = 50;

/** Pod tímhle počtem doručených se místo procent ukazují absolutní počty (3.11.4). */
export const SMALL_SAMPLE_THRESHOLD = 200;

export function deliveredEffective(counts: StatsCounts, source: DeliveredSource): number {
  if (source === 'provider_events') return counts.delivered;
  return Math.max(counts.sent - counts.bouncedHard - counts.bouncedSoft - counts.failed, 0);
}

/** Počet příjemců, u kterých měření otevření prokazatelně funguje. */
export function measurableAudience(counts: StatsCounts, source: DeliveredSource): number {
  return Math.max(deliveredEffective(counts, source) - counts.opensUniqueApple, 0);
}

export function isSmallSample(deliveredEffectiveValue: number): boolean {
  return deliveredEffectiveValue < SMALL_SAMPLE_THRESHOLD;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function computeRates(
  counts: StatsCounts,
  source: DeliveredSource,
  flags: TrackingFlags,
): Rates {
  const de = deliveredEffective(counts, source);
  const measurable = measurableAudience(counts, source);

  return {
    openRate: flags.trackOpens ? ratio(counts.opensUnique, de) : null,
    machineOpenShare: flags.trackOpens ? ratio(counts.opensUniqueApple, counts.opensUnique) : null,
    // Jiný jmenovatel schválně: Apple příjemci nikdy nemůžou být v čitateli,
    // takže by míra systematicky podstřelovala. Viz 3.11.2.
    verifiedOpenRate:
      flags.trackOpens && measurable >= VERIFIED_OPEN_MIN_DENOMINATOR
        ? ratio(counts.opensUniqueHuman, measurable)
        : null,
    clickRate: flags.trackClicks ? ratio(counts.clicksUniqueHuman, de) : null,
    clickToOpenRate:
      flags.trackClicks && flags.trackOpens
        ? ratio(counts.clicksUniqueHuman, counts.opensUniqueHuman)
        : null,
    // Z odeslaných, protože odmítnutá zpráva z definice doručená není.
    bounceRate: ratio(counts.bouncedHard + counts.bouncedSoft, counts.sent),
    complaintRate: ratio(counts.complained, de),
    unsubscribeRate: ratio(counts.unsubscribed, de),
  };
}
