import { z } from '@hono/zod-openapi';
import { campaignAudienceSchema } from '../types';

/**
 * Schémata veřejného API domény kampaní.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal sub-app do
 * `apps/web/src/server/routes/campaigns/**` a bral zod z balíčku `zod`.
 * Repozitář má pro všechny domény jeden tvar: definice cest leží v
 * `packages/core/src/<domena>/api/*.routes.ts`, staví se přes `@hono/zod-openapi`
 * a do aplikace se mountují v `apps/web/src/lib/api/openapi.ts`. Kontakty i segmenty
 * to tak dělají, takže druhý tvar by znamenal, že se OpenAPI dokument skládá
 * ze dvou různých zdrojů a `openapi-drift` na tom spadne.
 */

export const Uuid = z.uuid();

export const CampaignCountersSchema = z
  .object({
    total: z.number().int(),
    sent: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    delivered: z.number().int(),
    bounced: z.number().int(),
    complained: z.number().int(),
    pending: z.number().int(),
  })
  .openapi('CampaignCounters');

export const CampaignResponse = z
  .object({
    id: Uuid,
    name: z.string(),
    // Výčet je OTEVŘENÝ (část 4a, 4.1.1): schéma je proto `string`, ne `enum`.
    // Klient musí neznámou hodnotu tolerovat, a schéma, které ji zakáže, mu to bere.
    status: z.string(),
    subject: z.string(),
    preheader: z.string(),
    from_name: z.string(),
    from_email: z.string(),
    reply_to: z.string().nullable(),
    template_id: Uuid.nullable(),
    audience: z.unknown(),
    audience_size: z.number().int().nullable(),
    audience_breakdown: z.unknown().nullable(),
    audience_built_at: z.string().nullable(),
    provider_id: Uuid.nullable(),
    sender_domain_id: Uuid.nullable(),
    unsubscribe_list_id: Uuid.nullable(),
    track_opens: z.boolean(),
    track_clicks: z.boolean(),
    revision: z.number().int(),
    release_at: z.string().nullable(),
    scheduled_at: z.string().nullable(),
    schedule_timezone: z.string().nullable(),
    pause_reason: z.unknown().nullable(),
    counters: CampaignCountersSchema,
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    paused_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Campaign');

export const CreateCampaignRequest = z
  .object({
    name: z.string().min(1).max(200),
    subject: z.string().max(255).optional(),
    preheader: z.string().max(255).optional(),
    from_name: z.string().max(200).optional(),
    from_email: z.email().optional(),
    reply_to: z.email().nullable().optional(),
    template_id: Uuid.nullable().optional(),
    audience: campaignAudienceSchema.optional(),
    provider_id: Uuid.nullable().optional(),
    sender_domain_id: Uuid.nullable().optional(),
    unsubscribe_list_id: Uuid.nullable().optional(),
  })
  .strict()
  .openapi('CreateCampaignRequest');

export const PatchCampaignRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    subject: z.string().max(255).optional(),
    preheader: z.string().max(255).optional(),
    from_name: z.string().max(200).optional(),
    from_email: z.email().optional(),
    reply_to: z.email().nullable().optional(),
    template_id: Uuid.nullable().optional(),
    audience: campaignAudienceSchema.optional(),
    provider_id: Uuid.nullable().optional(),
    sender_domain_id: Uuid.nullable().optional(),
    unsubscribe_list_id: Uuid.nullable().optional(),
    track_opens: z.boolean().optional(),
    track_clicks: z.boolean().optional(),
    scheduled_at: z.iso.datetime().nullable().optional(),
    schedule_timezone: z.string().nullable().optional(),
  })
  .strict()
  .openapi('PatchCampaignRequest');

export const SendCampaignRequest = z
  .object({
    /**
     * Povinný a musí se rovnat aktuálnímu odhadu publika s tolerancí 1 %. Chrání před
     * tím, aby uživatel odeslal na výrazně jiné publikum, než viděl na obrazovce,
     * protože mezitím doběhl import.
     */
    confirm_recipient_count: z.number().int().min(0),
  })
  .strict()
  .openapi('SendCampaignRequest');

export const ScheduleCampaignRequest = z
  .object({
    scheduled_at: z.iso.datetime(),
    timezone: z.string().min(1),
    confirm_recipient_count: z.number().int().min(0),
  })
  .strict()
  .openapi('ScheduleCampaignRequest');

export const FindingSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning']),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('CampaignFinding');

export const AudienceBreakdownSchema = z
  .object({
    raw: z.number().int(),
    eligible: z.number().int(),
    excluded_suppressed: z.number().int(),
    excluded_unsubscribed: z.number().int(),
    excluded_unconfirmed: z.number().int(),
    excluded_snoozed: z.number().int(),
    excluded_processing_restricted: z.number().int(),
    excluded_invalid_email: z.number().int(),
    excluded_deleted: z.number().int(),
    excluded_sample: z.number().int(),
    duplicates_removed: z.number().int(),
  })
  .openapi('CampaignAudienceBreakdown');

export const PreflightResponse = z
  .object({
    can_send: z.boolean(),
    audience_estimate: z.number().int(),
    breakdown: AudienceBreakdownSchema,
    quota_remaining: z.number().int().nullable(),
    undo_window_seconds: z.number().int(),
    findings: z.array(FindingSchema),
    checked_at: z.string(),
  })
  .openapi('CampaignPreflight');

export const AudiencePreviewResponse = z
  .object({
    audience_estimate: z.number().int(),
    breakdown: AudienceBreakdownSchema,
    checked_at: z.string(),
  })
  .openapi('CampaignAudiencePreview');

export const ProgressResponse = z
  .object({
    campaign_id: Uuid,
    status: z.string(),
    counters: CampaignCountersSchema,
    ambiguous_count: z.number().int(),
    rate_per_second: z.number().nullable(),
    eta_seconds: z.number().int().nullable(),
    stalled: z.boolean(),
    pause_reason: z.unknown().nullable(),
    undo_remaining_seconds: z.number().int(),
    updated_at: z.string(),
  })
  .openapi('CampaignProgress');

export const MessageItem = z
  .object({
    id: Uuid,
    /**
     * `created_at` je součást klíče, ne kosmetika: `messages` je partitionovaná
     * podle něj, takže samotné `id` zprávu jednoznačně nezadresuje.
     */
    created_at: z.string(),
    status: z.string(),
    error_code: z.string().nullable(),
    provider_message_id: z.string().nullable(),
    sent_at: z.string().nullable(),
  })
  .openapi('CampaignMessage');

/** Ve stavu scheduled se smí měnit jen tyhle tři klíče, viz část 4a, 3.5.5. */
export { EDITABLE_WHILE_SCHEDULED } from '../control/schedule';
