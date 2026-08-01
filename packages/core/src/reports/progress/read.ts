import { sql } from 'drizzle-orm';
import type { Tx, WorkspaceContext } from '../../tx';
import { notFound } from '../errors';

/** Stavy, ve kterých se čísla ještě mění a obrazovka drží živý indikátor. */
const LIVE_STATUSES = new Set(['queueing', 'sending']);

export type CampaignProgress = {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  percent: number | null;
  watermarkAt: string | null;
  isSending: boolean;
  status: string;
};

/**
 * Čtení průběhu odesílání. Zdrojem je `campaign_stats`, kterou plní job
 * `tracking.refresh_campaign_progress` z P10 (3.9.5 části 5).
 * Tenhle balíček do agregací nezapisuje, hlídá to test `ownership.test.ts`.
 */
export async function readCampaignProgress(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignProgress> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.status,
           coalesce(s.materialized, 0)  AS materialized,
           coalesce(s.sent, 0)          AS sent,
           coalesce(s.failed, 0)        AS failed,
           coalesce(s.skipped, 0)       AS skipped,
           s.progress_watermark_at
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId} AND c.id = ${campaignId} AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const total = Number(row['materialized'] ?? 0);
  const sent = Number(row['sent'] ?? 0);
  const status = String(row['status']);

  return {
    campaignId,
    total,
    sent,
    failed: Number(row['failed'] ?? 0),
    skipped: Number(row['skipped'] ?? 0),
    // Procenta z nuly nejsou nula, jsou to procenta z ničeho. Proto null.
    percent: total > 0 ? Math.min(sent / total, 1) : null,
    watermarkAt: row['progress_watermark_at']
      ? new Date(row['progress_watermark_at'] as string | Date).toISOString()
      : null,
    isSending: LIVE_STATUSES.has(status),
    status,
  };
}

export type BucketDrift = {
  statsSent: number;
  bucketSum: number;
  /** Kampaň má bloky, ale řádek souhrnu ještě ne. Job z P10 nedoběhl. */
  statsMissing: boolean;
  matches: boolean;
};

/**
 * Čítač `campaign_stats.sent` a součet bloků píše tentýž job. Když se rozejdou,
 * report ukazuje jiné číslo v dlaždici než v grafu a nikdo neví, které platí.
 * Tahle funkce ten rozdíl pojmenuje. Nic neopravuje: oprava patří do P10.
 *
 * Řídicí tabulka je `campaigns`, ne `campaign_stats`. Řádek agregace vzniká
 * líně až prvním během jobu, a právě stav „bloky už jsou, souhrn ještě ne"
 * je drift, který má tahle funkce najít. S `FROM campaign_stats` by dotaz
 * nevrátil žádný řádek, obě čísla by spadla na nulu a funkce by ohlásila
 * `matches: true`, tedy pravý opak skutečnosti.
 */
export async function bucketDrift(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<BucketDrift> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(s.sent, 0) AS stats_sent,
           coalesce((
             SELECT sum(b.sent) FROM campaign_stats_buckets b
              WHERE b.workspace_id = c.workspace_id AND b.campaign_id = c.id
           ), 0) AS bucket_sum,
           (s.campaign_id IS NULL) AS stats_missing
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId} AND c.id = ${campaignId}
       AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const statsSent = Number(row['stats_sent'] ?? 0);
  const bucketSum = Number(row['bucket_sum'] ?? 0);
  return {
    statsSent,
    bucketSum,
    statsMissing: row['stats_missing'] === true,
    matches: statsSent === bucketSum,
  };
}
