import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { countsFromRow, emptyCounts, type StatsCounts } from '../metrics/counts';
import { NON_HUMAN_CLICK_SUBTYPES } from '../event-types';
import { notFound } from '../errors';

const MASK_HUMAN = 1;
const MASK_PROXY_APPLE = 2;
const MASK_PROXY_IMAGE = 4;

/**
 * Přepočet agregací kampaně od nuly. Zdrojem pravdy jsou message_engagement,
 * messages a message_events, tedy tabulky, do kterých se zapisuje přímo.
 * Slouží ke třem věcem: rekonstrukci po havárii, kontrole driftu v testech
 * a budoucímu příkazu CLI, který dodá P16.
 */
export async function recomputeCampaignCounts(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<StatsCounts> {
  const { rows: campaignRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT audience_built_at
      FROM campaigns
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${campaignId} AND deleted_at IS NULL
  `);
  const campaign = campaignRows[0];
  if (!campaign) throw notFound('campaign');
  const partitionKey = (campaign['audience_built_at'] ?? null) as Date | string | null;
  if (partitionKey === null) return emptyCounts();

  const { rows: messageRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(*)                                          AS materialized,
           count(*) FILTER (WHERE status = 'sent')           AS sent,
           count(*) FILTER (WHERE status = 'failed')         AS failed,
           count(*) FILTER (WHERE status = 'skipped')        AS skipped
      FROM messages
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND created_at   = ${partitionKey}
  `);

  const { rows: engagementRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(sum(open_count), 0)                      AS opens_total,
           count(*) FILTER (WHERE first_open_at IS NOT NULL) AS opens_unique,
           count(*) FILTER (WHERE first_human_open_at IS NOT NULL) AS opens_unique_human,
           count(*) FILTER (
             WHERE (open_class_mask & ${MASK_PROXY_APPLE}) <> 0
               AND (open_class_mask & ${MASK_HUMAN | MASK_PROXY_IMAGE}) = 0
           )                                                 AS opens_unique_apple,
           -- clicks_total je součet VŠECH prokliků, ne jen lidských. Human má
           -- vlastní čítač clicks_unique_human a P10 plní campaign_stats
           -- stejným způsobem. Se sum(human_click_count) by kontrola driftu
           -- hlásila rozdíl u každé kampaně, kterou navštívil skener.
           coalesce(sum(click_count), 0)                     AS clicks_total,
           count(*) FILTER (WHERE first_click_at IS NOT NULL) AS clicks_unique,
           count(*) FILTER (WHERE first_human_click_at IS NOT NULL) AS clicks_unique_human
      FROM message_engagement
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND created_at   = ${partitionKey}
  `);

  // Jména typů drží ck_message_events__type (R19). Tvrdost odrazu nese TYP.
  // Filtr na `bounce` nebo `complaint` by nevrátil nic a nic by nespadlo.
  const { rows: eventRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(DISTINCT message_id) FILTER (WHERE type = 'delivered')     AS delivered,
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_hard')  AS bounced_hard,
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_soft')  AS bounced_soft,
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')    AS complained,
           count(DISTINCT message_id) FILTER (WHERE type = 'unsubscribe')   AS unsubscribed,
           count(*) FILTER (
             WHERE type = 'click' AND subtype = ANY(${sql.param([...NON_HUMAN_CLICK_SUBTYPES])}::text[])
           )                                                                AS clicks_scanner
      FROM message_events
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND received_at >= ${partitionKey}
  `);

  return countsFromRow({
    ...(messageRows[0] ?? {}),
    ...(engagementRows[0] ?? {}),
    ...(eventRows[0] ?? {}),
  });
}

export type DriftReport = {
  matches: boolean;
  differences: Array<{ key: keyof StatsCounts; stored: number; recomputed: number }>;
};

export async function compareWithStored(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<DriftReport> {
  const recomputed = await recomputeCampaignCounts(tx, ctx, campaignId);
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT * FROM campaign_stats
     WHERE workspace_id = ${ctx.workspaceId} AND campaign_id = ${campaignId}
  `);
  const stored = countsFromRow(rows[0]);

  const differences = (Object.keys(recomputed) as Array<keyof StatsCounts>)
    .filter((key) => stored[key] !== recomputed[key])
    .map((key) => ({ key, stored: stored[key], recomputed: recomputed[key] }));

  return { matches: differences.length === 0, differences };
}
