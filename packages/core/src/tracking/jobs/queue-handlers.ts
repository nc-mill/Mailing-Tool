import { once, perJob } from '../../queues';
import { handleEventProcess, type EventProcessJobData } from '../ingest/event-process';
import { handleCleanupTokenUses } from './cleanup-token-uses';
import { handleIdentityMerge, type IdentityMergeJobData } from './identity-merge';
import { handleProcessEngagement, type ProcessEngagementJobData } from './process-engagement';
import {
  handleProcessProviderEvents,
  type ProcessProviderEventsJobData,
} from './process-provider-events';
import { handleRecomputeEngagementWindows } from './recompute-engagement-windows';
import { handleRefreshCampaignProgress } from './refresh-campaign-progress';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4).
 *
 * Jméno souboru i jméno exportu `handlers` jsou ZÁVAZNÁ: codegen globuje
 * `packages/core/src/<domena>/jobs/queue-handlers.ts`. Pod jiným jménem se
 * soubor přeloží, testy projdou a fronta se zaregistruje BEZ OBSLUHY: úloha se
 * zařadí, nikdo si ji nevyzvedne a nikde to nespadne.
 *
 * Klíč `./tracking/jobs` v mapě `exports` balíčku už existoval, jenže mířil na
 * tenhle soubor, který do teď nebyl. Import z workeru by se nerozřešil až při
 * stavbě produkční image, tedy daleko od příčiny.
 *
 * PROČ TENHLE SOUBOR ROSTL. Do téhle chvíle tu byla jediná obsluha
 * (`identity.merge`) a devět dalších front téhle domény stálo prázdných.
 * Mezi nimi `tracking.process_engagement`, tedy jediný článek, který ze
 * zapsaných otevření a prokliků vyrábí čísla v reportu. Otevření se měřilo,
 * proklik se měřil, řádky v `message_events` vznikaly, a report ukazoval samé
 * nuly, protože je nikdo nesečetl. Vypadalo to jako rozbité měření, přitom to
 * bylo nezapojené počítání.
 */
export const handlers = {
  /**
   * Zpracování dávky WEBOVÝCH událostí ze SDK.
   *
   * Producentem je `/e/track`. Fronta byla do teď prázdná, protože nebyl ani
   * producent, ani obsluha; endpoint by odpověděl 202 a v `web_events` by
   * nevzniklo nic. Deduplikace běží v okně sedmi dní, tedy přesně tak dlouho,
   * jak dlouho si SDK drží offline frontu.
   */
  'event.process': perJob<EventProcessJobData>(async (job) => {
    await handleEventProcess(job.data);
  }),

  /**
   * Navázání anonymní stopy na kontakt.
   *
   * Do téhle chvíle nebyla obsluha ani logika. Návštěvník se prokázal e-mailem
   * (klik v kampani, odeslaný formulář, přihlášení), úloha se zařadila do
   * fronty, ze které nikdo nečetl, a jeho dosavadní web události zůstaly
   * navždy viset na `anonymous_id`. V časové ose kontaktu tedy chyběla celá
   * část historie a nikde se to neohlásilo.
   *
   * `perJob` je POVINNÝ obal: pg-boss volá obsluhu s DÁVKOU úloh, kdežto
   * `handleIdentityMerge` bere jednu.
   */
  'identity.merge': perJob<IdentityMergeJobData>(async (job) => {
    await handleIdentityMerge(job);
  }),

  /**
   * Agregace otevření a prokliků. TENHLE ČLÁNEK ŘETĚZU CHYBĚL.
   *
   * Zařazuje ji `insertMessageEvents` ve stejné transakci jako zápis událostí,
   * takže úloha nemůže přežít rollback zápisu ani se ztratit po něm.
   */
  'tracking.process_engagement': perJob<ProcessEngagementJobData>(async (job) => {
    await handleProcessEngagement(job.data);
  }),

  /**
   * Přepočet doručenosti z událostí od poskytovatele.
   *
   * Producenta dnes NEMÁ: SNS webhook je zapojený jen do půlky (`snsWebhookDeps()`
   * vrací null, protože `setSnsWebhookDeps` nikdo nevolá), takže od Amazonu
   * nedorazí ani jedna událost a fronta `provider_event.process`, která by tuhle
   * zařazovala, obsluhu taky nemá. Obsluha je tu proto, aby se doručenost
   * spočítala v okamžiku, kdy se ta cesta dodělá, a hlavně proto, že totéž
   * počítá cronový `tracking.refresh_campaign_progress`, takže čísla dorovná
   * i bez ní.
   */
  'tracking.process_provider_events': perJob<ProcessProviderEventsJobData>(async (job) => {
    await handleProcessProviderEvents(job.data);
  }),

  /**
   * Průběh odesílání a doručenost. `once`, ne `perJob`: cron s prázdným
   * nákladem, takže víc úloh v dávce znamená víc tiků, ne víc práce.
   */
  'tracking.refresh_campaign_progress': once(() => handleRefreshCampaignProgress()),

  /** Denní přepočet klouzavých oken zapojení. Cron, prázdný náklad. */
  'tracking.recompute_engagement_windows': once(() => handleRecomputeEngagementWindows()),

  /** Hodinový úklid vypršelých nonců identitních tokenů. Cron, prázdný náklad. */
  'tracking.cleanup_token_uses': once(() => handleCleanupTokenUses()),
} as const;
