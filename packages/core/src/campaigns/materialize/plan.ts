import type { KnownCampaignStatus } from '../types';

export type ClaimDecision =
  { action: 'continue' } | { action: 'stop'; level: 'info' | 'warn' } | { action: 'noop' };

/**
 * Krok 1 materializace je podmineny UPDATE do queueing. Kdyz nevrati radek, job
 * NESMI skoncit. Drivejsi zneni rikalo "druhy pokus nevrati radek a job skonci"
 * a bylo to nebezpecne spatne: po padu workeru je kampan uz ve stavu queueing,
 * druhy pokus tedy nikdy radek nevrati, job by skoncil a kampan by v queueing
 * zustala trcet navzdy. Akceptacni kriterium 10 by neslo splnit.
 */
export function decideAfterFailedClaim(status: KnownCampaignStatus): ClaimDecision {
  switch (status) {
    case 'queueing':
    case 'sending':
      return { action: 'continue' };
    case 'paused':
      return { action: 'stop', level: 'info' };
    case 'cancelled':
    case 'failed':
    case 'sent':
    case 'partially_sent':
      return { action: 'noop' };
    default:
      return { action: 'stop', level: 'warn' };
  }
}
