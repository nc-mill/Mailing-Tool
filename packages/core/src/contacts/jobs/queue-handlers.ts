import { once, perJob } from '../../queues';
import { verifyFieldIndex, type VerifyFieldIndexPayload } from './verify-field-index';
import { exportSubjectData, type GdprExportPayload } from './gdpr-export';
import { bulkDelete, type BulkDeletePayload } from './bulk-delete';
import { bulkTag, type BulkTagPayload } from './bulk-tag';
import { rebuildConsentState, type RebuildConsentStatePayload } from './consents-rebuild-state';
import { runGdprErase, type GdprErasePayload } from './gdpr-erase';
import { severContactLinks, type SeverLinksPayload } from './gdpr-sever-links';
import { processInboundDelivery, type InboundProcessPayload } from './inbound-process';
import { bulkVocativeReview, type BulkVocativeReviewPayload } from './bulk-vocative-review';
import { cleanupPendingSubscriptions } from './cleanup-pending';
import { recomputeGreeting, type RecomputeGreetingPayload } from './recompute-greeting';
import { refingerprintContacts, type RefingerprintPayload } from './refingerprint';
import { retentionDispatchHandler, systemRetentionDispatchDeps } from './retention-dispatch';
import { runRetention, type RetentionRunPayload } from './retention-run';
import { stripAttribute, type StripAttributePayload } from './strip-attribute';

/**
 * Rejstřík obsluh domény kontaktů, který hledá codegen workeru (rozhodnutí D4).
 *
 * Jméno souboru, jeho umístění v `<domena>/jobs/` i jméno exportu `handlers`
 * jsou ZÁVAZNÁ: `apps/worker/codegen.mjs` globuje přesně tuhle cestu a generuje
 * z ní `import { handlers as hN } from '@mlain/core/contacts/jobs'`. K souboru
 * patří klíč `"./contacts/jobs"` v `packages/core/package.json`; bez něj by se
 * import nerozřešil až při stavbě produkční image.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Sedm obslužných modulů vedle něj existovalo,
 * mělo vlastní zelené testy a NIKDO je nezaregistroval. Fronty se přesto
 * zakládaly (`registerQueues` je zakládá i bez obsluhy), takže se úlohy řadily
 * do prázdna: uživatel smazal vlastní pole, dostal potvrzení a klíč zůstal
 * v `attributes` navždy; žádost o výmaz podle článku 17 se zapsala do
 * `gdpr_requests` a nikdy se neprovedla. Nic přitom nespadlo.
 *
 * `perJob` je u KAŽDÉ obsluhy povinný: pg-boss volá handler s DÁVKOU úloh,
 * kdežto tyhle funkce berou jednu. Bez obalu by dostaly pole, sáhly na `.data`
 * a dostaly `undefined`; fronta by se přitom zaregistrovala a worker naběhl,
 * takže by se to poznalo teprve na první skutečně zpracované úloze.
 *
 * Náklady jsou v camelCase, protože přesně tak je zapisuje producent
 * (`contacts/jobs/enqueue.ts` a jeho volající v `repo/`). Registr front P01
 * u týchž front vypisuje `payloadFields` ve snake_case, ale to je popis polí
 * pro test zákazu osobních údajů, ne serializační formát.
 */

/**
 * Fronty téhle domény jsou od 2026-08-02 zapojené VŠECHNY. Kdyby někdy zbyla
 * nějaká bez obsluhy, patří i s důvodem do `UNDELIVERED`
 * v `apps/worker/test/handler-coverage.test.ts`, jinak tam test spadne.
 */

/**
 * Rozcestník denního retenčního běhu. JEDNA FRONTA, DVA VÝZNAMY NÁKLADU.
 *
 * `retention.run` má v registru cron `20 4 * * *`, jenže `registerQueues`
 * plánuje každý cron s PRÁZDNÝM nákladem (`boss.schedule(name, cron, {}, …)`),
 * kdežto retence běží nad JEDNÍM projektem. Dřív proto cronový tik skončil
 * výjimkou. Jako pojistka to bylo správně, jako řešení ne: DENNÍ RETENČNÍ BĚH
 * NEMAZAL NIC, každou noc.
 *
 * Teď se náklad čte takhle:
 *
 *   prázdný        ... cronový tik, rozešle úlohu po projektech (dispečer)
 *   s workspaceId  ... skutečný úklid jednoho projektu
 *
 * Dispečer čte projekty pod rolí `mlain_maintenance` a vrací POUZE
 * identifikátory; vlastní mazání běží pod `mlain_app` v kontextu jednoho
 * projektu, takže na ně dopadá RLS stejně jako na požadavek z API. Rozprostírá
 * běhy do tří hodin podle otisku identifikátoru projektu, aby sto projektů
 * nespustilo sto souběžných mazacích dávek v jednu sekundu.
 *
 * Rozlišovat podle tvaru nákladu je tu bezpečné, protože prázdný náklad UMÍ
 * poslat jedině cron. Zařazení z API i z CLI `workspaceId` vždycky vyplňuje.
 */

export const handlers = {
  /**
   * Kontrola, že vlastní pole je dotazovatelné přes GIN index nad `attributes`.
   *
   * Fronta se DŘÍV jmenovala v platformovém registru `contact_fields.build_index`,
   * kdežto producent zařazoval `contact_fields.verify_index`. Úloha tedy chodila
   * do fronty, kterou registr neznal, a index se tiše nikdy nepřestavěl.
   * Jména jsou od téhle chvíle srovnaná na `verify_index`, tedy na to, co
   * odpovídá skutečnosti: job žádné DDL nedělá, jen PROVĚŘUJE (rozhodnutí R14).
   */
  'contact_fields.verify_index': perJob<VerifyFieldIndexPayload>(async (job) => {
    await verifyFieldIndex(job.data);
  }),

  /**
   * Hromadné mazání kontaktů.
   *
   * Do téhle chvíle to byla nejhorší díra z celé mapy, a ne proto, že by fronta
   * neměla obsluhu. Tlačítko v rozhraní existovalo, dialog se otevřel, uživatel
   * potvrdil, a `POST /api/v1/contacts/bulk-delete` vrátil 404, protože trasa
   * v `contacts/api/` neexistovala. Úloha se tedy ani nezařadila.
   */
  'contacts.bulk_delete': perJob<BulkDeletePayload>(async (job) => {
    await bulkDelete(job.data);
  }),

  /**
   * Export dat subjektu podle článku 20 GDPR.
   *
   * Dřív se archiv sestavil a ZAHODIL, protože nebylo kam ho uložit. Subjekt
   * dostal potvrzení, že se export udělal, a žádný soubor. To je horší než
   * chyba: navenek to vypadá jako splněná zákonná lhůta.
   *
   * Úložiště je schválně TOTÉŽ jako u exportu kontaktů (`exports`, jednorázový
   * token jen jako SHA-256, `expires_at`, retence maže soubor i řádek). Vlastní
   * cesta pro tenhle jeden druh souboru by znamenala druhé místo, na které musí
   * myslet zálohy i výmaz, a na jedno z nich by se dřív nebo později zapomnělo.
   */
  'gdpr.export_subject': perJob<GdprExportPayload>(async (job) => {
    await exportSubjectData(job.data);
  }),

  'contacts.bulk_tag': perJob<BulkTagPayload>(async (job) => {
    await bulkTag(job.data);
  }),
  'contacts.strip_attribute': perJob<StripAttributePayload>(async (job) => {
    await stripAttribute(job.data);
  }),
  'consents.rebuild_state': perJob<RebuildConsentStatePayload>(async (job) => {
    await rebuildConsentState(job.data);
  }),
  'gdpr.erase': perJob<GdprErasePayload>(async (job) => {
    await runGdprErase(job.data);
  }),
  'gdpr.sever_links': perJob<SeverLinksPayload>(async (job) => {
    await severContactLinks(job.data);
  }),
  'inbound.process': perJob<InboundProcessPayload>(async (job) => {
    await processInboundDelivery(job.data);
  }),
  /**
   * Přepočet oslovení. Zařazuje ho `updateWorkspace`, když se změní nastavení,
   * ze kterého se oslovení skládá (tvar oslovení, oslovování jménem nebo
   * příjmením).
   *
   * Přepočet RESPEKTUJE zámek `vocative_locked`: ručně potvrzené oslovení se
   * nepřepisuje. Bez toho by hromadná změna nastavení zahodila práci, kterou
   * někdo odklikal ve frontě ke kontrole, a nikdo by se to nedozvěděl.
   */
  'contacts.recompute_greeting': perJob<RecomputeGreetingPayload>(async (job) => {
    await recomputeGreeting(job.data);
  }),
  'contacts.bulk_vocative_review': perJob<BulkVocativeReviewPayload>(async (job) => {
    await bulkVocativeReview(job.data);
  }),
  'contacts.refingerprint': perJob<RefingerprintPayload>(async (job) => {
    await refingerprintContacts(job.data);
  }),

  /**
   * Úklid nepotvrzených přihlášení. `once`, ne `perJob`: je to cronová úloha
   * s prázdným nákladem, takže víc úloh v dávce znamená víc tiků, ne víc práce.
   * Projekty si vyjmenuje sama pod rolí `mlain_maintenance`.
   */
  'contacts.cleanup_pending': once(async () => {
    await cleanupPendingSubscriptions();
  }),

  'retention.run': perJob<Partial<RetentionRunPayload>>(async (job) => {
    const workspaceId = job.data.workspaceId;
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      await retentionDispatchHandler(systemRetentionDispatchDeps());
      return;
    }
    await runRetention({ workspaceId });
  }),
} as const;
