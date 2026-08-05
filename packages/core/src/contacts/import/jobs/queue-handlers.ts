import { perJob } from '../../../queues';
import { createSystemContext } from '../../../identity/context';
import { importLimits } from '../limits';
import { handler as runImport } from './run-import';
import { recoverStaleImports } from './recover-stale';
import { runRetention } from './retention';
import { enqueueImportJob } from './enqueue';
import { inWorkspaceTx } from '../db';

/**
 * Codegen workeru globuje soubory tohohle jména. Názvy front jsou z registru P01
 * doslova, ne odvozené: neregistrovaná fronta by shodila `queue()` při zařazení.
 *
 * Fronta `contacts.bulk_vocative_review` tady NENÍ. Po rozhodnutí U3 ji vlastní
 * celou P07 (úkoly 37 a 38 tohohle plánu jsou vyřazené).
 */
// Jméno `handlers` je závazné, ne libovolné: codegen workeru generuje
// `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
// jménem se soubor sice zkompiluje a testy projdou, ale bundle workeru spadne
// na „No matching export for import handlers", tedy až při buildu image.
// Každá obsluha se obaluje `perJob`: pg-boss volá handler s DÁVKOU úloh,
// kdežto tyhle funkce berou jednu. Bez obalu by dostaly pole, sáhly na `.data`
// a dostaly `undefined`. Fronty by se přitom zaregistrovaly a worker naběhl,
// takže by se to poznalo teprve na první skutečně zpracované úloze.
export const handlers = {
  'contacts.import': perJob(runImport),
  // I tahle obsluha musí přes `perJob`, přestože je psaná rovnou tady.
  // Bez obalu má jiný tvar než ostatní a registr handlerů se pak nedá popsat
  // jedním typem; pg-boss by jí navíc předal celou dávku.
  'contacts.cleanup_import_files': perJob(
    async (job: { data: { workspaceId: string } }): Promise<{ deleted: number }> => {
      const ctx = createSystemContext(job.data.workspaceId, 'contacts.cleanup_import_files');
      return { deleted: await runRetention(ctx) };
    },
  ),
} as const;

/**
 * Obnova zaseknutých importů. Není to fronta z registru, ale plánovaný sken,
 * který zařazuje do `contacts.import`. Zařazení jde přes kontext projektu
 * z payloadu, takže RLS platí i pro obnovený import.
 */
export async function recoverStaleImportsJob(): Promise<{ recovered: number }> {
  const recovered = await recoverStaleImports(
    { staleMinutes: importLimits().staleMinutes },
    async (payload) => {
      const ctx = createSystemContext(payload.workspaceId, 'contacts.import');
      await inWorkspaceTx(ctx, (tx) =>
        enqueueImportJob(
          tx,
          'contacts.import',
          { ...payload },
          {
            singletonKey: payload.importId,
            retryLimitOverride: 0,
            // OBNOVA PO PÁDU, tady se `drop` chce. Sken hledá importy, které se
            // dlouho nehnuly, a mezi ně se snadno připlete běh, který ještě žije.
            // Zahození takového zařazení je správný výsledek: import běží dál,
            // jen ho tenhle sken zbytečně považoval za mrtvý.
            onMerged: 'drop',
          },
        ),
      );
    },
  );
  return { recovered };
}
