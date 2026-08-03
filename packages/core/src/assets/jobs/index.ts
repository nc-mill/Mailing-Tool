import { once, perJob, type QueueHandler } from '../../queues';
import { cleanupAssetsHandler, systemCleanupAssetsDeps } from './cleanup-assets';
import { processAssetJob, type ProcessAssetPayload } from './process-asset';
import { systemVerifyRefcountsDeps, verifyRefcountsHandler } from './verify-refcounts';

/**
 * Hotové obsluhy tří front domény assetů.
 *
 * TENHLE SOUBOR NENÍ REJSTŘÍK, KTERÝ HLEDÁ CODEGEN WORKERU. Fronty se jmenují
 * `content.process_asset`, `content.cleanup_assets` a
 * `content.verify_asset_refcounts`, a codegen (rozhodnutí D4) odvozuje adresář
 * z PREFIXU JMÉNA FRONTY, ne z toho, kde logika bydlí. Rejstřík je proto
 * `packages/core/src/content/jobs/queue-handlers.ts` a připojuje se odsud,
 * úplně stejně jako `content.brand_extract` z domény značky.
 *
 * `perJob` u `content.process_asset` je povinný: pg-boss volá obsluhu s DÁVKOU
 * úloh, kdežto `processAssetJob` bere jednu. Bez obalu by dostala pole, sáhla
 * na `.data` a dostala `undefined`; fronta by se přitom zaregistrovala a worker
 * naběhl, takže by se to poznalo teprve na první skutečně zpracované úloze.
 *
 * `once` u obou cronových front je povinný ze zrcadlového důvodu: pg-boss jim
 * doručí prázdný náklad a víc úloh v dávce znamená jen víc natikaných tiků, ne
 * víc práce. S `perJob` by úklid proběhl tolikrát, kolik je úloh v dávce.
 */
export const assetQueueHandlers: Record<string, QueueHandler> = {
  'content.process_asset': perJob<ProcessAssetPayload>(async (job) => processAssetJob(job.data)),
  'content.cleanup_assets': once(() => cleanupAssetsHandler(systemCleanupAssetsDeps())),
  'content.verify_asset_refcounts': once(() => verifyRefcountsHandler(systemVerifyRefcountsDeps())),
};

export {
  cleanupAssetsHandler,
  PURGE_AFTER_DAYS,
  systemCleanupAssetsDeps,
  type CleanupAssetsDeps,
  type CleanupAssetsResult,
} from './cleanup-assets';
export { processAssetJob, type ProcessAssetPayload } from './process-asset';
export {
  systemVerifyRefcountsDeps,
  verifyRefcountsHandler,
  type VerifyRefcountsDeps,
  type VerifyRefcountsResult,
} from './verify-refcounts';
