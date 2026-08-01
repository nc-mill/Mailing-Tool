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
export const queueHandlers = {
  'contacts.import': runImport,
  'contacts.cleanup_import_files': async (job: {
    data: { workspaceId: string };
  }): Promise<{ deleted: number }> => {
    const ctx = createSystemContext(job.data.workspaceId, 'contacts.cleanup_import_files');
    return { deleted: await runRetention(ctx) };
  },
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
          },
        ),
      );
    },
  );
  return { recovered };
}
