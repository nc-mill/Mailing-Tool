import { z } from 'zod';

/**
 * Vycty ve verejnem API jsou OTEVRENE (cast 4a, 4.1.1). Pridani hodnoty do vyctu
 * v odpovedi neni breaking change a smi prijit kdykoliv v ramci v1. Klient proto
 * nesmi mit switch bez vetve default a nikdy nesmi odpoved zahodit kvuli nezname
 * hodnote. Vzor 'a' | 'b' | (string & {}) napovida zname hodnoty a nezakazuje nezname.
 */
export const KNOWN_CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'queueing',
  'sending',
  'paused',
  'sent',
  'partially_sent',
  'cancelled',
  'failed',
  'schedule_missed',
] as const;

export type KnownCampaignStatus = (typeof KNOWN_CAMPAIGN_STATUSES)[number];
export type CampaignStatus = KnownCampaignStatus | (string & {});

export function isKnownCampaignStatus(value: string): value is KnownCampaignStatus {
  return (KNOWN_CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/** Stavy, ze kterych uz neni cesta ven. failed ma jako jediny reset_to_draft. */
export const TERMINAL_CAMPAIGN_STATUSES = ['sent', 'partially_sent', 'cancelled'] as const;

/**
 * Claim dotaz kontraktu bere kampane ve stavu queueing i sending, protoze sender
 * odebira praci uz behem materializace. Pauza proto musi fungovat z obou stavu.
 */
export const SENDING_CAMPAIGN_STATUSES = ['queueing', 'sending'] as const;

const uuid = z.uuid();

export const campaignAudienceSchema = z
  .object({
    include: z.object({
      lists: z.array(uuid).default([]),
      segments: z.array(uuid).default([]),
    }),
    exclude: z.object({
      lists: z.array(uuid).default([]),
      segments: z.array(uuid).default([]),
    }),
  })
  .strict()
  .refine((a) => a.include.lists.length + a.include.segments.length > 0, {
    message: 'audience_empty',
    path: ['include'],
  });

export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export type CampaignCounters = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  delivered: number;
  bounced: number;
  complained: number;
  /** Dopocitane: total - sent - failed - skipped. Nikdy se neuklada. */
  pending: number;
};

export function emptyCounters(): CampaignCounters {
  return {
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    pending: 0,
  };
}

export function withPending(c: Omit<CampaignCounters, 'pending'>): CampaignCounters {
  return { ...c, pending: Math.max(0, c.total - c.sent - c.failed - c.skipped) };
}

export type Campaign = {
  id: string;
  workspace_id: string;
  name: string;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  audience: CampaignAudience;
  audience_size: number | null;
  audience_built_at: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  /**
   * Předvolba odesílatele, ze které se pět polí výš předvyplnilo. Do
   * `IMMUTABLE_WHILE_SENDING` ZÁMĚRNĚ NEPATŘÍ: sender ji nečte, odeslaná zpráva
   * na ní nezávisí, takže by zmrazení jen bránilo úklidu bez jakéhokoli užitku.
   */
  sender_identity_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  revision: number;
  release_at: string | null;
  scheduled_at: string | null;
  schedule_timezone: string | null;
  counters: CampaignCounters;
  started_at: string | null;
  finished_at: string | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Sloupce, ktere se po prechodu do sending nesmi zmenit. Sender si je nacte jednou
 * a drzi v cache pod klicem (campaign_id, revision).
 *
 * Vynucuje to APLIKACE, ne databazovy trigger (rozhodnuti D22): chyba `campaign_locked`
 * na API a inkrementace `revision`. P03 nema v celem planu jediny CREATE TRIGGER
 * a jeho konvence rika, ze `updated_at` meni aplikace.
 */
export const IMMUTABLE_WHILE_SENDING = [
  'subject',
  'preheader',
  'from_name',
  'from_email',
  'reply_to',
  'compiled_html',
  'compiled_text',
  'compiled_fields',
  // compile_meta a compiled_hash patri do seznamu podle rozhodnuti D18: sender proti
  // compile_meta porovnava pocet znacek odkazu a materializace z nej bere renderSchema.
  // Zmena za behu by znamenala, ze cast publika ma jina data nez zbytek.
  'compile_meta',
  'compiled_hash',
  'provider_id',
  'sender_domain_id',
  'track_opens',
  'track_clicks',
  'unsubscribe_list_id',
  'audience_built_at',
  'release_at',
] as const;
