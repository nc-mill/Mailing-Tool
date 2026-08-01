import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { ApiError } from '../../errors/api-error';
import { createSystemContext } from '../../identity/context';
import { segmentsLogger } from '../logging';
import { pgErrorCode, withWorkspace, withoutContext, type Tx } from '../../tx';
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
 * Odliší „není co přepočítat" od „nevidím na nic".
 *
 * Ptá se na dvě čísla ve stejné transakci. `users` je v `TABLES_WITHOUT_RLS`,
 * takže se čte vždycky a říká, jestli je instalace vůbec používaná. `segments`
 * je pod RLS a bez systémového bypassu vrací nulu. Když má instalace uživatele,
 * ale plánovač nevidí ANI JEDEN segment, je to skoro jistě chybějící bypass,
 * ne prázdná databáze, a job musí spadnout, ne reportovat úspěch.
 */
async function assertCrossWorkspaceVisibility(tx: Tx): Promise<void> {
  const { rows } = await tx.execute<{ users: number; segments: number }>(sql`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM segments)::int AS segments
  `);
  const seen = rows[0];
  if (seen && seen.users > 0 && seen.segments === 0) {
    throw new ApiError('service_unavailable', {
      params: {
        code: 'cross_workspace_scan_blocked',
        table: 'segments',
        users: seen.users,
      },
    });
  }
}

/**
 * Hodinový cron: segmenty s `cached_at` starším než 6 hodin, napříč projekty.
 *
 * POZOR, tohle je jediné místo celého plánu, které sahá mimo jeden projekt,
 * a je to zároveň místo, kde se nejsnáz vyrobí trvale tichá porucha.
 * `segments` má politiku `ws_isolation` a `withoutContext` žádný kontext
 * nenastavuje, takže `current_setting('mlain.workspace_id', true)` je NULL,
 * porovnání s NULL je NULL, tedy nepravda, tedy ŽÁDNÉ ŘÁDKY. A hlavně:
 * ŽÁDNÁ CHYBA. Bez systémového bypassu by tenhle cron roky hlásil
 * `{ scheduled: 0 }`, index `idx_segments__stale` by zůstal nepoužitý
 * a nikdo by si toho nevšiml, protože nula zastaralých segmentů je
 * naprosto věrohodná hodnota. Do dodání politiky `system_bypass` drží
 * hranici strážce výš.
 */
export const scheduleStale = async (
  enqueue: (p: RecountPayload) => Promise<void>,
): Promise<number> => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await withoutContext(async (tx: Tx) => {
    await assertCrossWorkspaceVisibility(tx);
    return tx
      .select({ id: segments.id, workspaceId: segments.workspaceId })
      .from(segments)
      .where(
        and(
          isNull(segments.deletedAt),
          eq(segments.kind, 'dynamic'),
          or(isNull(segments.cachedAt), lt(segments.cachedAt, cutoff)),
        ),
      );
  });
  for (const row of rows) await enqueue({ workspaceId: row.workspaceId, segmentId: row.id });
  segmentsLogger().info({ scheduled: rows.length }, 'segments.recount scheduled');
  return rows.length;
};
