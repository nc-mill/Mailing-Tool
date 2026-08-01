import { ApiError } from '../errors/api-error';
import type { KnownCampaignStatus } from './types';

/**
 * Tabulka prechodu z casti 4a, 3.1.3. Zakazane prechody, ktere stoji za pripomenuti:
 *  - sent -> sending: znovuodeslani je nejcastejsi pricina odhlaseni. Kdo chce poslat
 *    znovu, udela duplikat kampane, coz je jina akce s vlastnim ID.
 *  - paused -> sent: pozastavena kampan musi projit resume nebo cancel, jinak uzivatel
 *    nevi, jestli zbytek odesel.
 *  - sending -> draft: kampan, ze ktere neco odeslo, se uz nikdy nesmi stat draftem.
 *  - queueing -> paused je NAOPAK povoleny. Kontrakt casti 1 omezuje na queueing
 *    a sending SENDER, ne aplikaci; materialize_timeout je legitimni pripad.
 */
export const CAMPAIGN_TRANSITIONS: Record<KnownCampaignStatus, readonly KnownCampaignStatus[]> = {
  draft: ['scheduled', 'queueing'],
  scheduled: ['draft', 'scheduled', 'queueing', 'cancelled', 'schedule_missed'],
  queueing: ['sending', 'paused', 'cancelled', 'failed'],
  sending: ['paused', 'sent', 'partially_sent', 'cancelled'],
  paused: ['queueing', 'sending', 'cancelled'],
  sent: [],
  partially_sent: [],
  cancelled: [],
  failed: ['draft'],
  schedule_missed: ['draft', 'scheduled', 'queueing', 'cancelled'],
};

export function allowedFrom(from: KnownCampaignStatus): KnownCampaignStatus[] {
  return [...CAMPAIGN_TRANSITIONS[from]];
}

export function canTransition(from: KnownCampaignStatus, to: KnownCampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: KnownCampaignStatus, to: KnownCampaignStatus): void {
  if (canTransition(from, to)) return;
  // ODCHYLKA OD PLÁNU: plán házel `AppError` s polem `detail`. Repozitář má
  // `ApiError` z `../errors/api-error` a strojově čitelné údaje se v něm nesou
  // v `params`; volné pole `detail` v jeho volbách není. Kód i chování zůstávají.
  throw new ApiError('invalid_state_transition', {
    params: { from, to, allowed: allowedFrom(from) },
  });
}

/**
 * Vychozi stavy pro podmineny UPDATE. Prechod se vzdy dela jedinym dotazem
 * s podminkou status = ANY($allowed_from), takze dva soubezne pozadavky nemohou
 * provest tentyz prechod dvakrat. Kdyz dotaz nevrati radek, API vraci 409.
 */
export function sourcesFor(to: KnownCampaignStatus): KnownCampaignStatus[] {
  return (Object.keys(CAMPAIGN_TRANSITIONS) as KnownCampaignStatus[]).filter((from) =>
    canTransition(from, to),
  );
}
