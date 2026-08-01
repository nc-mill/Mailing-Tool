import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';

export type Granularity = '5m' | 'hour' | 'day';

export type BucketPoint = {
  at: string;
  sent: number;
  delivered: number;
  opensUnique: number;
  clicksUnique: number;
  bounced: number;
};

export type BucketsResult = {
  granularity: Granularity;
  points: BucketPoint[];
  /**
   * Bloky starší třiceti dní slévá retenční job P10 do hodinových (3.15.2, krok 5).
   * Report to musí přiznat, jinak si uživatel myslí, že v datech je díra.
   */
  compacted: boolean;
};

const MAX_POINTS = 10_000;
const COMPACTION_AFTER_DAYS = 30;

export async function readCampaignBuckets(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; granularity: Granularity; timezone: string },
): Promise<BucketsResult> {
  const rows = await selectPoints(tx, ctx, input);
  const points = rows.map((row) => ({
    at: new Date(row['at'] as string | Date).toISOString(),
    sent: Number(row['sent'] ?? 0),
    delivered: Number(row['delivered'] ?? 0),
    opensUnique: Number(row['opens_unique'] ?? 0),
    clicksUnique: Number(row['clicks_unique'] ?? 0),
    bounced: Number(row['bounced'] ?? 0),
  }));

  const first = points[0];
  const oldest = first ? new Date(first.at) : null;
  const compacted =
    input.granularity === '5m' &&
    oldest !== null &&
    Date.now() - oldest.getTime() > COMPACTION_AFTER_DAYS * 24 * 60 * 60 * 1000;

  return { granularity: input.granularity, points, compacted };
}

async function selectPoints(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; granularity: Granularity; timezone: string },
): Promise<Array<Record<string, unknown>>> {
  if (input.granularity === '5m') {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT bucket_at AS at, sent, delivered, opens_unique, clicks_unique, bounced
        FROM campaign_stats_buckets
       WHERE workspace_id = ${ctx.workspaceId}
         AND campaign_id  = ${input.campaignId}
       ORDER BY bucket_at
       LIMIT ${MAX_POINTS}
    `);
    return rows;
  }

  if (input.granularity === 'hour') {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT date_trunc('hour', bucket_at) AS at,
             sum(sent)          AS sent,
             sum(delivered)     AS delivered,
             sum(opens_unique)  AS opens_unique,
             sum(clicks_unique) AS clicks_unique,
             sum(bounced)       AS bounced
        FROM campaign_stats_buckets
       WHERE workspace_id = ${ctx.workspaceId}
         AND campaign_id  = ${input.campaignId}
       GROUP BY 1
       ORDER BY 1
       LIMIT ${MAX_POINTS}
    `);
    return rows;
  }

  // Den se počítá v časové zóně projektu, ne v UTC. Kampaň odeslaná ve 23:30
  // patří v Praze do dalšího dne a report to musí ukázat tak, jak to vidí uživatel.
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT (date_trunc('day', bucket_at AT TIME ZONE ${input.timezone}) AT TIME ZONE ${input.timezone}) AS at,
           sum(sent)          AS sent,
           sum(delivered)     AS delivered,
           sum(opens_unique)  AS opens_unique,
           sum(clicks_unique) AS clicks_unique,
           sum(bounced)       AS bounced
      FROM campaign_stats_buckets
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${input.campaignId}
     GROUP BY 1
     ORDER BY 1
     LIMIT ${MAX_POINTS}
  `);
  return rows;
}
