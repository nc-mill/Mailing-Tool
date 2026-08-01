import { withWorkspace, type WorkspaceContext } from '../../tx';
import type { PauseReason } from '../pause-reason';
import { rawSql } from '../repo/raw-sql';

/**
 * Pauza musi byt rychla a nesmi nic ztratit. Mechanismus: sender se aplikace nepta,
 * ale claim dotaz obsahuje join na campaigns.status. Staci tedy zmenit stav kampane
 * a sender prestane brat novou praci.
 *
 * IN ('queueing','sending'), ne jen 'sending'. Omezeni z kontraktu plati pro SENDER,
 * aplikaci neomezuje; materialize_timeout je legitimni pauza z queueing. Drivejsi
 * zneni filtrovalo jen na sending, takze UPDATE by zasahl nula radku, job by povazoval
 * pauzu za provedenou a kampan by v queueing visela navzdy.
 *
 * Latence pauzy je doba, nez sender dokonci rozpracovanou davku. Pri SENDER_BATCH_SIZE
 * 100 a typicke kvote 14 zprav za sekundu jsou to jednotky sekund. Zpravy ve stavu
 * claimed dobehnou, tvrde zastaveni se v MVP 0 nedela.
 */
export async function pauseCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
  reason: PauseReason,
): Promise<{ paused: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE campaigns
          SET status = 'paused', paused_at = now(), pause_reason = $3::jsonb, updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          AND status IN ('queueing','sending')`,
        [campaignId, ctx.workspaceId, JSON.stringify(reason)],
      ),
    );
    return { paused: (r.rowCount ?? 0) > 0 };
  });
}

export async function pauseAllForProvider(
  ctx: WorkspaceContext,
  providerId: string,
  reason: PauseReason,
): Promise<{ paused: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE campaigns
          SET status = 'paused', paused_at = now(), pause_reason = $3::jsonb, updated_at = now()
        WHERE workspace_id = $1 AND provider_id = $2 AND deleted_at IS NULL
          AND status IN ('queueing','sending')`,
        [ctx.workspaceId, providerId, JSON.stringify(reason)],
      ),
    );
    return { paused: r.rowCount ?? 0 };
  });
}
