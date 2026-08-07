import { once, perJob } from '../../../queues';
import { createSystemContext } from '../../../identity/context';
import { listWorkspaceIds } from '../../../platform/maintenance-scan';
import { importLimits } from '../limits';
import { importLogger } from '../logging';
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
  /*
   * RETENCE NAHRANÝCH SOUBORŮ IMPORTU.
   *
   * `perJob` tu být NESMÍ a dřív tu byl. Fronta má v registru `cron: '5 3 * * *'`
   * a `payloadFields: []`, takže náklad je PRÁZDNÝ objekt. Obsluha z něj brala
   * `job.data.workspaceId`, dostala `undefined` a `createSystemContext` na tom
   * skončil chybou `validation_failed`. Padalo to tedy KAŽDOU NOC, pokaždé
   * stejně, a nahrané soubory se nesmazaly nikdy: leží v `DATA_DIR` dál i s
   * adresami, které do nich zákazník nahrál.
   *
   * Projekty si sken hledá sám, stejně jako obnova zaseknutých importů níž.
   */
  'contacts.cleanup_import_files': once(() => cleanupImportFilesJob()),
  /*
   * OBNOVA ZASEKNUTÝCH IMPORTŮ, zapojená 7. 8. 2026.
   *
   * `recoverStaleImportsJob` existoval od začátku, měl vlastní test a migrace 0024
   * mu kvůli skenu napříč projekty zavedla grant i politiku. **Nevolal ho ale nikdo**,
   * protože fronta nebyla v registru.
   *
   * Následek nebyl kosmetický: `confirmImport` (`import/service.ts:341`) odmítne
   * KAŽDÝ další import v projektu, dokud v něm leží řádek ve stavu `importing`.
   * Zabitý worker uprostřed importu tedy projektu zamkl importování natrvalo
   * a jediná cesta ven byla ruční zásah do databáze. Přesně to se 7. 8. stalo
   * ve vývojové instalaci a zadavatel na to narazil.
   *
   * `perJob` tu být NESMÍ: cron posílá tik s prázdným nákladem a sken si projekty
   * hledá sám pod rolí `mlain_maintenance`. Obal by ho volal jednou za úlohu v dávce,
   * tedy tolikrát, kolik tiků se nakupilo.
   */
  'contacts.recover_stale_imports': once(() => recoverStaleImportsJob()),
} as const;

/**
 * Retence nahraných souborů napříč instalací.
 *
 * Dvoutakt je závazný a je popsaný v `campaigns/jobs/system-deps.ts`: výčet
 * projektů přijde z role `mlain_maintenance`, která umí číst `workspaces`
 * napříč instalací, ale nic víc. Vlastní úklid pak běží pod `mlain_app`
 * v systémovém kontextu jednoho projektu, takže na `imports` dopadá RLS
 * úplně stejně jako na požadavek z API.
 *
 * Pád jednoho projektu NESMÍ zastavit ostatní. Nejčastější příčina je nedostupný
 * `DATA_DIR`, a to je porucha instalace, ne toho jednoho projektu; zastavit se
 * na prvním by znamenalo, že se zbytku instalace neuklidí nikdy.
 */
export async function cleanupImportFilesJob(): Promise<{ deleted: number; failed: number }> {
  const log = importLogger();
  let deleted = 0;
  let failed = 0;
  for (const workspaceId of await listWorkspaceIds()) {
    const ctx = createSystemContext(workspaceId, 'contacts.cleanup_import_files');
    try {
      deleted += await runRetention(ctx);
    } catch (error) {
      failed += 1;
      log.error(
        {
          job: 'contacts.cleanup_import_files',
          workspace_id: workspaceId,
          err: error instanceof Error ? error.message : String(error),
        },
        'retence souborů importu v projektu selhala, pokračuje se dalším',
      );
    }
  }
  return { deleted, failed };
}

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
