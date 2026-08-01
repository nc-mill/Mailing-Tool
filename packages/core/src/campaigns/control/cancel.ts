import { withWorkspace, type WorkspaceContext } from '../../tx';
// ODCHYLKA OD PLÁNU: plán importoval `cancelPendingBatch` z `@mlain/core/campaigns`,
// tedy z barrelu, který tenhle soubor sám reexportuje. Cyklus se vynechává importem
// přímo z repository; volaná funkce i chování jsou beze změny.
import { cancelPendingBatch } from '../repo/outbox';
import { rawSql } from '../repo/raw-sql';

/**
 * Zruseni je nevratne. Krok 1 prepne kampan, krok 2 vyprazdni outbox po davkach.
 * Zpravy ve stavu claimed se NERUSI, dobehnou; po dobehnuti dopocita citace watchdog.
 *
 * Uklid se opakuje, dokud UPDATE vraci nenulovy pocet, ne jednim pruchodem. Symetricky
 * k tomu materializacni smycka po zjisteni cancelled sama zavola tenhle uklid jeste
 * jednou, protoze mezi kontrolou stavu a koncem davky se da stihnout dalsi INSERT.
 */
export async function cancelCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
  input: { reason: string },
): Promise<{ cancelled: boolean; skipped: number; cleanedBatches: number }> {
  const head = await withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ audience_built_at: string | null }>(
      rawSql(
        `UPDATE campaigns
          SET status = 'cancelled', cancel_reason = $3, finished_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          AND status IN ('scheduled','queueing','sending','paused','schedule_missed')
        RETURNING audience_built_at`,
        [campaignId, ctx.workspaceId, input.reason],
      ),
    );
    return r.rows[0] ?? null;
  });

  if (!head) return { cancelled: false, skipped: 0, cleanedBatches: 0 };
  if (!head.audience_built_at) return { cancelled: true, skipped: 0, cleanedBatches: 0 };

  let skipped = 0;
  let batches = 0;
  for (;;) {
    const n = await cancelPendingBatch(ctx, {
      campaignId,
      audienceBuiltAt: head.audience_built_at,
    });
    batches += 1;
    skipped += n;
    if (n === 0) break;
  }
  return { cancelled: true, skipped, cleanedBatches: batches };
}
