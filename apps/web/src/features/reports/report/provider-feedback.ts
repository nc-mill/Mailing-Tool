import type { StatsPayload } from './report-model';

/**
 * CHYBÍ NÁM ZPĚTNÁ VAZBA OD ODESÍLACÍ SLUŽBY?
 *
 * Doručení, odrazy a stížnosti se NEDAJÍ zjistit z odeslání. Události
 * `delivered`, `bounced_hard`, `bounced_soft` a `complained` zapisuje jedině
 * příjem oznámení od odesílací služby (SNS od SES, `providers.routes.ts`).
 * Odesílací proces sám je nezapisuje nikde, ověřeno hledáním v `apps/sender`.
 *
 * Když oznámení nechodí, zůstanou všechny tři čítače na nule a report je
 * ukáže jako „0" a „v normě", tedy „poslali jsme a nikomu se to neodrazilo".
 * To je táž záměna, kterou u vypnutého měření otevření a prokliků hlídá
 * `metricDisplay` v jádře: nula znamená „měřili jsme a nic nebylo", zatímco
 * tady se neměřilo vůbec.
 *
 * Rozlišují se DVĚ různé příčiny, protože každá se řeší jinak.
 */
export type FeedbackGap =
  /** SMTP účet. Žádná oznámení neposílá a posílat je nebude. */
  | 'not_reported'
  /**
   * Účet, který oznámení posílat umí, ale k téhle kampani nedorazilo ani
   * jedno. Skoro vždycky to znamená nedokončené nastavení oznámení.
   */
  | 'no_events';

/**
 * Kolik času po dokončení rozesílky se ještě čeká, než se mlčení služby
 * považuje za problém. Kratší okno by hlásilo poplach u kampaně, které
 * oznámení jen ještě nestihla dojít; stejnou hranici používá pruh
 * „čísla se dopočítávají" (`report-banner.ts`).
 */
const SETTLING_MS = 15 * 60 * 1000;

/**
 * `null` znamená „zpětnou vazbu máme", tedy čísla v panelu problémů jsou
 * naměřená a nula je nula.
 */
export function feedbackGap(payload: StatsPayload, now: Date): FeedbackGap | null {
  if (payload.delivered_source === 'derived_from_sent') return 'not_reported';

  // Nic se ještě neodeslalo: není o čem hlásit, že chybí.
  if ((payload.counts.sent ?? 0) === 0) return null;

  /*
   * Ptá se `delivered_known`, NE `last_event_at`, a je to oprava, ne úklid.
   * Do `last_event_at` dnes sahá i zpracování otevření a prokliků, takže jediné
   * otevření by ho posunulo a tenhle test by prohlásil zpětnou vazbu za
   * doručenou, přestože od odesílací služby nedorazilo nic. Panel problémů by
   * pak ukázal „0 odrazů, 0 stížností" jako naměřený stav.
   *
   * `delivered_known` je v téhle větvi rovnou to, na co se ptáme: větev
   * `derived_from_sent` skončila výš, takže `true` tu znamená „aspoň jedna
   * událost o osudu zprávy od služby dorazila".
   */
  if (payload.delivered_known) return null;

  // Dokud kampaň běží nebo právě dojela, mlčení služby není nález.
  if (payload.status === 'sending' || payload.status === 'queueing') return null;
  const reference = payload.finished_at ?? payload.started_at;
  if (reference === null) return null;
  if (now.getTime() - new Date(reference).getTime() < SETTLING_MS) return null;

  return 'no_events';
}

/** Klíč vysvětlení pod tabulkou problémů. */
export const FEEDBACK_GAP_BODY_KEY: Record<FeedbackGap, string> = {
  not_reported: 'report.problems.notReportedBody',
  no_events: 'report.problems.noEventsBody',
};
