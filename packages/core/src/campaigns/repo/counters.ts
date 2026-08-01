import { withWorkspace, type WorkspaceContext } from '../../tx';
import { rawSql } from './raw-sql';

/**
 * Citace se deli na dve skupiny, ktere maji ruzny zdroj pravdy a NESMI se plest:
 *   predani provideru: total, sent, failed, skipped        <- messages.status
 *   doruceni:          delivered, bounced, complained      <- message_events
 *
 * failed_count tedy znamena "nepodarilo se predat provideru", ne "nedorazilo".
 * Zprava, kterou SES prijal a ktera se pak odrazila, ma status = 'sent', pocita se
 * do sent_count i do bounce_count, a do failed_count NIKDY.
 *
 * Zameny tehle dvojice projde code review, protoze COUNT(status = 'failed') vypada
 * jako nedorucitelnost a chova se spravne az do prvniho bouncu. Proto jsou to dva
 * oddelene dotazy nad dvema tabulkami a kazdy ma vlastni test.
 */
export async function reconcileHandoverCounters(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `WITH agg AS (
         SELECT
           count(*) FILTER (WHERE true)                AS total,
           count(*) FILTER (WHERE status = 'sent')     AS sent,
           count(*) FILTER (WHERE status = 'failed')   AS failed,
           count(*) FILTER (WHERE status = 'skipped')  AS skipped
         FROM messages
        WHERE campaign_id = $1 AND workspace_id = $2 AND kind = 'campaign'
       )
       UPDATE campaigns c
          SET total_count = agg.total, sent_count = agg.sent,
              failed_count = agg.failed, skipped_count = agg.skipped,
              updated_at = now()
         FROM agg
        WHERE c.id = $1 AND c.workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
  });
}

export async function reconcileDeliveryCounters(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `WITH agg AS (
         SELECT
           count(DISTINCT message_id) FILTER (WHERE type = 'delivered')   AS delivered,
           count(DISTINCT message_id) FILTER (WHERE type IN ('bounced_hard','bounced_soft')) AS bounced,
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')  AS complained
         FROM message_events
        WHERE campaign_id = $1 AND workspace_id = $2
       )
       UPDATE campaigns c
          SET delivered_count = agg.delivered, bounce_count = agg.bounced,
              complaint_count = agg.complained, updated_at = now()
         FROM agg
        WHERE c.id = $1 AND c.workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
  });
}

export async function isOutboxDrained(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string },
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    // Bez `kind = 'campaign'` by se kampan neuzavrela, dokud nedobehne testovaci mail,
    // ktery si nekdo poslal minutu pred koncem. Testovaci zpravy nejsou soucasti publika
    // a jejich stav o dokonceni kampane nevypovida nic.
    const r = await tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM messages
        WHERE campaign_id = $1 AND created_at = $2::timestamptz
          AND kind = 'campaign'
          AND status IN ('pending','claimed')`,
        [input.campaignId, input.audienceBuiltAt],
      ),
    );
    return r.rows[0]!.n === 0;
  });
}
