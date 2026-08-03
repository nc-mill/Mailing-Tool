import { createSystemContext } from '../../identity/context';
import { perJob, type QueueHandler } from '../../queues';
import { createBrandExtractDeps } from './brand-extract-deps';
import { runBrandExtraction } from './brand-extract';

/** Jméno úlohy pro audit: `audit_log.actor_label` se plní právě z něj. */
const JOB = 'content.brand_extract';

/**
 * Náklad fronty `content.brand_extract`.
 *
 * Jména polí jsou camelCase, protože přesně tak je zapisuje producent
 * (`requestExtraction` v `brand-service.ts`). Registr front P01 vypisuje
 * `payloadFields` ve snake_case, ale to je popis polí pro test zákazu osobních
 * údajů, ne serializační formát; stejné rozlišení platí v doméně kontaktů.
 *
 * `workspaceId` v nákladu BÝT MUSÍ: extrakce se čte i zapisuje pod RLS a bez
 * projektu není pod čím otevřít transakci. Přečíst ho z řádku nejde, protože
 * ten řádek se bez kontextu projektu nedá načíst.
 */
export type BrandExtractJobData = {
  workspaceId: string;
  extractionId: string;
};

/**
 * Obsluha fronty `content.brand_extract` v podobě, kterou pg-boss opravdu volá.
 *
 * `perJob` je povinný: pg-boss doručuje DÁVKU úloh, kdežto `runBrandExtraction`
 * bere jednu. Bez obalu by obsluha dostala pole, sáhla na `.data` a dostala
 * `undefined`. Fronta by se přitom zaregistrovala a worker naběhl, takže by se
 * to poznalo teprve na první skutečně zpracované úloze.
 *
 * Závislosti se skládají AŽ TADY, jednou za úlohu, protože jsou vázané na
 * projekt z nákladu. Předchozí podoba obsluhy měla podpis `(job: { data, deps })`
 * a čekala, že jí `deps` někdo podstrčí zvenčí; worker takový parametr nemá
 * čím naplnit, takže se obsluha nedala zaregistrovat vůbec.
 *
 * Tohle je zároveň jediné místo v celém řetězu, kde se z řetězce v nákladu
 * stává ověřený `WorkspaceContext`, a proto tu ta hranice je: `createSystemContext`
 * je jediná legitimní továrna kontextu a sama si ověří, že id je UUID. Kompoziční
 * kořen pod ní už bere jen hotový kontext, takže se o izolaci nikde níž
 * nerozhoduje podle holého řetězce (`identity/scope.test.ts`).
 */
export const brandExtractHandler: QueueHandler = perJob<BrandExtractJobData>(async (job) => {
  const { workspaceId, extractionId } = job.data;
  if (typeof workspaceId !== 'string' || typeof extractionId !== 'string') {
    throw new Error(
      'Náklad content.brand_extract musí mít workspaceId i extractionId. ' +
        'Bez projektu se řádek pod RLS nenačte a extrakce by tiše zůstala v pending.',
    );
  }
  const ctx = createSystemContext(workspaceId, JOB);
  await runBrandExtraction({ extractionId }, createBrandExtractDeps(ctx));
});
