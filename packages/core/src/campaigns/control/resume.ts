import { withWorkspace, type WorkspaceContext } from '../../tx';
import { rawSql } from '../repo/raw-sql';

/**
 * Cilovy stav NENI vzdy sending. Kdyz byla kampan pozastavena behem materializace
 * (phase <> 'done'), vraci se do queueing a resume znovu posle job campaign.materialize,
 * ktery pokracuje od kurzoru. Kdyby sla vzdy do sending, krok 3 materializace
 * (podminka WHERE status = 'queueing') by zasahl nula radku a kampan by navzdy
 * zustala s nulovym total_count. Sender rozdil mezi queueing a sending nevnima,
 * claim dotaz bere oba stavy.
 */
export async function resumeCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<{ resumed: boolean; status: 'queueing' | 'sending' | null }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ status: 'queueing' | 'sending' }>(
      rawSql(
        `UPDATE campaigns
          SET status = CASE
                         WHEN EXISTS (SELECT 1 FROM campaign_audience_progress p
                                       WHERE p.campaign_id = campaigns.id AND p.phase <> 'done')
                         THEN 'queueing'
                         ELSE 'sending'
                       END,
              paused_at = NULL, pause_reason = NULL, updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND status = 'paused'
        RETURNING status`,
        [campaignId, ctx.workspaceId],
      ),
    );
    const row = r.rows[0];
    return { resumed: !!row, status: row?.status ?? null };
  });
}
