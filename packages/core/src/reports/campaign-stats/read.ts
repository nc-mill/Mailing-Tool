import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { countsFromRow, type StatsCounts } from '../metrics/counts';
import {
  computeRates,
  deliveredEffective,
  isSmallSample,
  type DeliveredSource,
  type Rates,
} from '../metrics/rates';
import { openBreakdown, type OpenBreakdown } from '../metrics/open-breakdown';
import { predictedOpens, type PredictedOpens } from '../metrics/predicted-opens';
import { notFound } from '../errors';

export type CampaignStatsRead = {
  campaignId: string;
  name: string;
  subject: string;
  /** Otevřený výčet, registr vlastní část 4a. Klient nesmí dělat exhaustivní switch. */
  status: string;
  trackOpens: boolean;
  trackClicks: boolean;
  deliveredSource: DeliveredSource;
  counts: StatsCounts;
  deliveredEffective: number;
  rates: Rates;
  breakdown: OpenBreakdown;
  predicted: PredictedOpens | null;
  smallSample: boolean;
  audienceBuiltAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
  updatedAt: Date;
  version: number;
};

/**
 * Neznámý typ provideru není chyba: výčet je podle 3.11 části 4a otevřený.
 * Rozhodne se podle toho, jestli od něj kdy přišla událost doručení.
 */
export function resolveDeliveredSource(
  providerType: string | null,
  counts: StatsCounts,
): DeliveredSource {
  if (providerType === 'smtp') return 'derived_from_sent';
  if (providerType === 'ses') return 'provider_events';
  return counts.delivered > 0 ? 'provider_events' : 'derived_from_sent';
}

export async function readCampaignStats(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignStatsRead> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id            AS campaign_id,
           c.name,
           c.subject,
           c.status,
           c.track_opens,
           c.track_clicks,
           c.audience_built_at,
           c.started_at,
           c.finished_at,
           p.type          AS provider_type,
           s.materialized, s.sent, s.failed, s.skipped, s.delivered,
           s.bounced_hard, s.bounced_soft, s.complained, s.unsubscribed,
           s.opens_total, s.opens_unique, s.opens_unique_human, s.opens_unique_apple,
           s.clicks_total, s.clicks_unique, s.clicks_unique_human, s.clicks_scanner,
           s.first_event_at, s.last_event_at, s.updated_at, s.version
      FROM campaigns c
      LEFT JOIN campaign_stats s
             ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p
             ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.id = ${campaignId}
       AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const counts = countsFromRow(row);
  const trackOpens = row['track_opens'] === true;
  const trackClicks = row['track_clicks'] === true;
  const deliveredSource = resolveDeliveredSource(
    typeof row['provider_type'] === 'string' ? row['provider_type'] : null,
    counts,
  );
  const de = deliveredEffective(counts, deliveredSource);

  return {
    campaignId: String(row['campaign_id']),
    name: String(row['name'] ?? ''),
    subject: String(row['subject'] ?? ''),
    status: String(row['status']),
    trackOpens,
    trackClicks,
    deliveredSource,
    counts,
    deliveredEffective: de,
    rates: computeRates(counts, deliveredSource, { trackOpens, trackClicks }),
    breakdown: openBreakdown(counts),
    predicted: trackOpens ? predictedOpens(counts, de) : null,
    smallSample: isSmallSample(de),
    audienceBuiltAt: asDate(row['audience_built_at']),
    startedAt: asDate(row['started_at']),
    finishedAt: asDate(row['finished_at']),
    firstEventAt: asDate(row['first_event_at']),
    lastEventAt: asDate(row['last_event_at']),
    updatedAt: asDate(row['updated_at']) ?? new Date(0),
    version: Number(row['version'] ?? 0),
  };
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
