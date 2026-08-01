import type { StatsCounts } from './counts';

/**
 * Tři patra z 8.7.3 části 6. Skupiny jsou přesně ty, které vrací část 5:
 * ověřená (opens_unique_human), pravděpodobně automatická (opens_unique_apple)
 * a nejistá (zbytek, tedy zprávy otevřené jen se třídou unknown).
 *
 * "Kliklo" NENÍ třída otevření. Je to samostatná věta pod pruhem a nese ji
 * pole clickedFromVerified.
 */
export type OpenBreakdown = {
  verified: number;
  machine: number;
  uncertain: number;
  total: number;
  clickedFromVerified: number;
};

export function openBreakdown(counts: StatsCounts): OpenBreakdown {
  const verified = counts.opensUniqueHuman;
  const machine = counts.opensUniqueApple;
  const uncertain = Math.max(counts.opensUnique - verified - machine, 0);
  return {
    verified,
    machine,
    uncertain,
    total: counts.opensUnique,
    clickedFromVerified: counts.clicksUniqueHuman,
  };
}

/** Podíly pro pruh. Základem je součet skupin, ne total, aby pruh vždy sedl na sto procent. */
export function breakdownShares(breakdown: OpenBreakdown): {
  verified: number;
  machine: number;
  uncertain: number;
} {
  const sum = breakdown.verified + breakdown.machine + breakdown.uncertain;
  if (sum <= 0) return { verified: 0, machine: 0, uncertain: 0 };
  return {
    verified: breakdown.verified / sum,
    machine: breakdown.machine / sum,
    uncertain: breakdown.uncertain / sum,
  };
}
