import {
  audienceBreakdown,
  INERT_GATES,
  type AudienceBreakdown,
  type GateKey,
} from '../../segments/audience';
import type { WorkspaceContext } from '../../tx';
import type { AudienceGateCounts } from '../ports';
import type { CampaignAudience } from '../types';

/**
 * JEDINÝ překlad rozpadu publika z části 2 na jedenáctiklíčový tvar `AudienceGateCounts`.
 *
 * Existuje samostatně, ne uvnitř preflightu, schválně. Tentýž překlad potřebuje ještě
 * `deps.countGates` jobu `campaign.materialize`, který přes `setGateCounters` zapisuje
 * `campaigns.audience_breakdown`, tedy sloupec, ze kterého čte report po odeslání.
 * Kdyby si ho ten, kdo job zapojí, napsal znovu, byly by v repozitáři dva překlady
 * a za půl roku by se rozešly; rozdíl by se přitom projevil až tím, že se kontrolní
 * seznam před odesláním a report po odeslání liší o pár lidí.
 *
 * Až vznikne `countAudienceGates` z požadavku R-P07.1, přepne se na něj tady a nikde jinde.
 */

/**
 * Dvě brány z jedenácti nemá část 2 čím naplnit a je to VĚDOMÉ, ne opomenutí:
 * smazané a vymazané kontakty odečítá už ve vstupní množině, ne branou. Zůstávají
 * proto na nule, aby jich `AudienceGateCounts` mělo dál jedenáct.
 */
const GATE_TO_KEY: Record<GateKey, keyof AudienceGateCounts> = {
  suppressed: 'excluded_suppressed',
  unsubscribed: 'excluded_unsubscribed',
  unconfirmed: 'excluded_unconfirmed',
  snoozed: 'excluded_snoozed',
  processing_restricted: 'excluded_processing_restricted',
  duplicate: 'duplicates_removed',
  sample: 'excluded_sample',
};

export const ZERO_GATE_COUNTS: AudienceGateCounts = {
  raw: 0,
  eligible: 0,
  excluded_suppressed: 0,
  excluded_unsubscribed: 0,
  excluded_unconfirmed: 0,
  excluded_snoozed: 0,
  excluded_processing_restricted: 0,
  excluded_invalid_email: 0,
  excluded_deleted: 0,
  excluded_sample: 0,
  duplicates_removed: 0,
};

/**
 * ZNÁMÉ OMEZENÍ, které se nesmí zamlčet. Brány `duplicate` a `sample` jsou v části 2
 * v `INERT_GATES`, tedy natvrdo nula. Řádek „ukázkové kontakty" v kontrolním seznamu
 * proto ukáže nulu i tehdy, když materializace ukázkové kontakty doopravdy vyhodí,
 * takže `eligible` může být o ně vyšší než počet skutečně odeslaných zpráv.
 * Součet bran a `eligible` na `raw` sedí dál, chybí jen rozdělení uvnitř `eligible`.
 * Dorovná se to, až část 2 obě brány naplní; tenhle soubor se přitom nezmění.
 */
export const KNOWN_INERT_GATES = INERT_GATES;

/** Čistý překlad tvaru. Bez databáze, aby šel otestovat na jedné hodnotě. */
export function toGateCounts(breakdown: AudienceBreakdown): AudienceGateCounts {
  const counts: AudienceGateCounts = {
    ...ZERO_GATE_COUNTS,
    raw: breakdown.input,
    eligible: breakdown.willSend,
  };
  for (const gate of breakdown.gates) {
    counts[GATE_TO_KEY[gate.key]] = gate.count;
  }
  return counts;
}

/**
 * Rozpad publika kampaně po pojmenovaných branách. Bere `include` stranu publika,
 * protože vylučující výběr část 2 nezná; odečtení `exclude` řeší volající
 * (`audienceState`), aby zůstalo vidět, kolik lidí ubral výběr a kolik brána.
 */
export async function campaignAudienceGates(
  ctx: WorkspaceContext,
  audience: CampaignAudience,
  opts: { asOf: Date; timezone: string },
): Promise<AudienceGateCounts> {
  return toGateCounts(
    await audienceBreakdown(
      ctx,
      { listIds: audience.include.lists, segmentIds: audience.include.segments },
      opts,
    ),
  );
}
