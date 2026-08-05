import type { StatsPayload } from './report-model';

export type ReportBanner = {
  key: string;
  tone: 'info' | 'warning';
  values: Record<string, string | number>;
};

const SETTLING_MS = 15 * 60 * 1000;
const FINAL_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * SOUHRN KAMPANĚ VŮBEC NEVZNIKL.
 *
 * `readCampaignStats` v jádře připojuje `campaign_stats` přes LEFT JOIN.
 * Když řádek souhrnu chybí, projdou všechny čítače jako nuly a `updated_at`
 * se nastaví na `new Date(0)`, tedy počátek epochy (viz `read.ts`, řádek
 * s `?? new Date(0)`). Skutečný řádek má `updated_at` vždycky z `now()`.
 *
 * Bez tohohle rozlišení report tvrdí „Kliklo 0 z doručených, Doručeno 0
 * z odeslaných" u kampaně, která opravdu odeslala, protože souhrn se ještě
 * nepřepočítal. Naměřeno v prohlížeči na odeslané kampani, kde `/progress`
 * hlásil 3 odeslané a `/stats` samé nuly s `version: 0`.
 *
 * Je to jiná věc než chybějící zpětná vazba od odesílací služby
 * (`provider-feedback.ts`): tam data nemáme, tady je jen nikdo nesečetl.
 */
export function statsNotComputed(payload: StatsPayload): boolean {
  return new Date(payload.updated_at).getTime() === 0;
}

/**
 * Pruh nad reportem podle 8.7.4 části 6. Pořadí podmínek je pořadí priorit:
 * běžící odesílání je důležitější než "čísla se dopočítávají".
 */
export function reportBanner(payload: StatsPayload, now: Date): ReportBanner | null {
  if (payload.status === 'sending' || payload.status === 'queueing') {
    return {
      key: 'report.banner.progress',
      tone: 'info',
      values: { sent: payload.counts.sent ?? 0, total: payload.counts.materialized ?? 0 },
    };
  }

  if (payload.status === 'cancelled' || payload.status === 'partially_sent') {
    return {
      key: 'report.banner.stopped',
      tone: 'warning',
      values: { sent: payload.counts.sent ?? 0, total: payload.counts.materialized ?? 0 },
    };
  }

  /*
   * ODCHYLKA OD PLÁNU, KTEROU SI VYNUTIL JEHO VLASTNÍ TEST. Plán měřil stáří
   * od `started_at`. Jeho test ale čeká `settling` v čase 14:59 u kampaně,
   * která se začala odesílat ve 14:38, tedy o 21 minut dřív, což je za
   * patnáctiminutovým oknem. Správný okamžik je DOKONČENÍ rozesílky
   * (`finished_at`): věta „většina otevření a kliknutí dorazí během první
   * hodiny" se vztahuje k poslednímu odeslanému e-mailu, ne k prvnímu.
   * U kampaně bez `finished_at` se bere `started_at`, aby pruh nezmizel úplně.
   */
  const reference = payload.finished_at ?? payload.started_at;
  if (reference === null) return null;
  const age = now.getTime() - new Date(reference).getTime();

  if (age < SETTLING_MS) return { key: 'report.banner.settling', tone: 'info', values: {} };
  if (age < FINAL_AFTER_MS) return { key: 'report.banner.mayChange', tone: 'info', values: {} };
  return null;
}
