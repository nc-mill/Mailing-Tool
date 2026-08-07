import { eq } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { createSystemContext } from '../../identity/context';
import { listStaleSegments } from '../../platform/maintenance-scan';
import { segmentsLogger } from '../logging';
import { pgErrorCode, withWorkspace, type Tx } from '../../tx';
import { recountSegment } from '../service';

export type RecountPayload = { workspaceId: string; segmentId: string };

/**
 * `singletonKey` negarantuje právě jedno spuštění, takže je job idempotentní:
 * přepočet je čtení plus zápis odvozené hodnoty, opakování nic nezkazí.
 */
export const handler = async (job: {
  data: RecountPayload;
}): Promise<{ count: number; exact: boolean }> => {
  // Aktér typu system nese `job`, což je text, ne `id`, což by mělo být UUID.
  // Kdyby se sem dostal tvar { kind: 'system', id: 'segments.recount' }, skončil
  // by řetězec 'segments.recount' v uuid sloupci jako 22P02.
  const ctx = createSystemContext(job.data.workspaceId, 'segments.recount');
  await withWorkspace(ctx, (tx: Tx) =>
    tx
      .update(segments)
      .set({ recomputeState: 'running' })
      .where(eq(segments.id, job.data.segmentId)),
  );
  try {
    const row = await recountSegment(ctx, job.data.segmentId);
    return { count: row.cachedCount ?? 0, exact: row.cachedIsExact ?? false };
  } catch (error) {
    await withWorkspace(ctx, (tx: Tx) =>
      tx
        .update(segments)
        // pgErrorCode, ne error.code: přes drizzle je error.code undefined,
        // takže by se do last_error_code vždycky uložilo 'unknown'.
        .set({ recomputeState: 'error', lastErrorCode: pgErrorCode(error) ?? 'unknown' })
        .where(eq(segments.id, job.data.segmentId)),
    );
    throw error;
  }
};

/**
 * Hodinový cron: segmenty s `cached_at` starším než 6 hodin, napříč projekty.
 *
 * OPRAVA. Tenhle sken běžel pod `withoutContext`, tedy pod `mlain_app` BEZ
 * nastaveného `mlain.workspace_id`. `segments` má politiku `ws_isolation`,
 * takže `current_setting('mlain.workspace_id', true)` je NULL, porovnání s NULL
 * je NULL, tedy nepravda, tedy ŽÁDNÉ ŘÁDKY. Bez systémového bypassu by tenhle
 * cron roky hlásil `{ scheduled: 0 }`, index `idx_segments__stale` by zůstal
 * nepoužitý a nikdo by si toho nevšiml, protože nula zastaralých segmentů je
 * naprosto věrohodná hodnota. Do dodání bypassu držel hranici strážce, který
 * job shodil hlasitě.
 *
 * Politiku i grant dodává migrace 0024 pod rolí `mlain_maintenance`, sken sám
 * i strážce leží v `platform/maintenance-scan.ts`. Ten soubor je schválně
 * JEDINÉ místo aplikace, které čte napříč projekty.
 *
 * Hranici stáří počítá tenhle modul a předává ji skenu hotovou. Sken si ji
 * nevyrábí z `now()` ze stejného důvodu, z jakého lhůtu na obnovu projektu
 * vlastní úloha a ne politika: konstanta se smí změnit.
 */
export const scheduleStale = async (
  enqueue: (p: RecountPayload) => Promise<void>,
): Promise<number> => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await listStaleSegments(cutoff);
  for (const row of rows) await enqueue({ workspaceId: row.workspaceId, segmentId: row.segmentId });
  segmentsLogger().info({ scheduled: rows.length }, 'segments.recount scheduled');
  return rows.length;
};
