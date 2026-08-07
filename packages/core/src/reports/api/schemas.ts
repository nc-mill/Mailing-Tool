import { z } from '@hono/zod-openapi';
import type { CampaignStatsRead } from '../campaign-stats/read';

/**
 * ODCHYLKA OD PLÁNU: plán psal `z.string().uuid()`. V zod 4 je tenhle tvar
 * zastaralý a zbytek repozitáře používá `z.uuid()` (viz `segments/api/schemas.ts`).
 * Chování je stejné, jen se drží jeden tvar napříč doménami.
 */
export const uuidParam = z.object({ id: z.uuid() });

export const countsSchema = z.object({
  materialized: z.number(),
  sent: z.number(),
  skipped: z.number(),
  failed: z.number(),
  rejected: z.number(),
  delivered: z.number(),
  delivered_effective: z.number(),
  bounced_hard: z.number(),
  bounced_soft: z.number(),
  complained: z.number(),
  unsubscribed: z.number(),
  opens_total: z.number(),
  opens_unique: z.number(),
  opens_unique_human: z.number(),
  opens_unique_apple: z.number(),
  clicks_total: z.number(),
  clicks_unique: z.number(),
  clicks_unique_human: z.number(),
  clicks_scanner: z.number(),
});

export const ratesSchema = z.object({
  open_rate: z.number().nullable(),
  machine_open_share: z.number().nullable(),
  verified_open_rate: z.number().nullable(),
  click_rate: z.number().nullable(),
  click_to_open_rate: z.number().nullable(),
  bounce_rate: z.number().nullable(),
  complaint_rate: z.number().nullable(),
  unsubscribe_rate: z.number().nullable(),
});

export const campaignStatsSchema = z.object({
  campaign_id: z.string(),
  name: z.string(),
  subject: z.string(),
  // Otevřený výčet, registr vlastní část 4a. Union by klienta rozbil u nové hodnoty.
  status: z.string(),
  track_opens: z.boolean(),
  track_clicks: z.boolean(),
  delivered_source: z.enum(['provider_events', 'derived_from_sent']),
  /**
   * Rozlišuje „nikomu nedošlo" od „nevíme, protože nám poskytovatel události
   * neposílá". Bez něj obrazovka ukazuje nulu jako fakt, i když je to jen
   * chybějící údaj. Nová hodnota do `delivered_source` by rozbila klienty,
   * kteří nad ním dělají exhaustivní switch; samostatný příznak ne.
   */
  delivered_known: z.boolean(),
  counts: countsSchema,
  rates: ratesSchema,
  open_breakdown: z.object({
    verified: z.number(),
    machine: z.number(),
    uncertain: z.number(),
    total: z.number(),
    clicked_from_verified: z.number(),
  }),
  predicted_opens: z
    .object({ low_count: z.number(), high_count: z.number(), sample_size: z.number() })
    .nullable(),
  small_sample: z.boolean(),
  audience_built_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  first_event_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  version: z.number(),
  updated_at: z.string(),
});

export function toStatsResponse(read: CampaignStatsRead): z.infer<typeof campaignStatsSchema> {
  return {
    campaign_id: read.campaignId,
    name: read.name,
    subject: read.subject,
    status: read.status,
    track_opens: read.trackOpens,
    track_clicks: read.trackClicks,
    delivered_source: read.deliveredSource,
    delivered_known: read.deliveredKnown,
    counts: {
      materialized: read.counts.materialized,
      sent: read.counts.sent,
      skipped: read.counts.skipped,
      failed: read.counts.failed,
      rejected: read.counts.rejected,
      delivered: read.counts.delivered,
      delivered_effective: read.deliveredEffective,
      bounced_hard: read.counts.bouncedHard,
      bounced_soft: read.counts.bouncedSoft,
      complained: read.counts.complained,
      unsubscribed: read.counts.unsubscribed,
      opens_total: read.counts.opensTotal,
      opens_unique: read.counts.opensUnique,
      opens_unique_human: read.counts.opensUniqueHuman,
      opens_unique_apple: read.counts.opensUniqueApple,
      clicks_total: read.counts.clicksTotal,
      clicks_unique: read.counts.clicksUnique,
      clicks_unique_human: read.counts.clicksUniqueHuman,
      clicks_scanner: read.counts.clicksScanner,
    },
    rates: {
      open_rate: read.rates.openRate,
      machine_open_share: read.rates.machineOpenShare,
      verified_open_rate: read.rates.verifiedOpenRate,
      click_rate: read.rates.clickRate,
      click_to_open_rate: read.rates.clickToOpenRate,
      bounce_rate: read.rates.bounceRate,
      complaint_rate: read.rates.complaintRate,
      unsubscribe_rate: read.rates.unsubscribeRate,
    },
    open_breakdown: {
      verified: read.breakdown.verified,
      machine: read.breakdown.machine,
      uncertain: read.breakdown.uncertain,
      total: read.breakdown.total,
      clicked_from_verified: read.breakdown.clickedFromVerified,
    },
    predicted_opens: read.predicted
      ? {
          low_count: read.predicted.lowCount,
          high_count: read.predicted.highCount,
          sample_size: read.predicted.sampleSize,
        }
      : null,
    small_sample: read.smallSample,
    audience_built_at: read.audienceBuiltAt?.toISOString() ?? null,
    started_at: read.startedAt?.toISOString() ?? null,
    finished_at: read.finishedAt?.toISOString() ?? null,
    first_event_at: read.firstEventAt?.toISOString() ?? null,
    last_event_at: read.lastEventAt?.toISOString() ?? null,
    version: read.version,
    updated_at: read.updatedAt.toISOString(),
  };
}
