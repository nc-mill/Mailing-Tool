import { z } from 'zod';

/**
 * campaigns.pause_reason je KONTRAKTNI sloupec typu jsonb (cast 1, 4.10.1), ne text.
 * Do sloupce zapisuje i sender pres sloupcovy GRANT UPDATE (status, pause_reason)
 * a potrebuje vedle kodu predat i to, kdo pauzu udelal, kdy a ktera instance to byla.
 * Textovy sloupec by ty tri udaje neunesl a Go strana by do nej zapsala JSON jako retezec.
 */
export const PAUSE_REASON_CODES = [
  // zapisuje sender (i aplikace, viz nize)
  'render_failure_rate',
  'credentials_undecryptable',
  'provider_quota_exhausted',
  'provider_unavailable',
  // zapisuje vyhradne aplikace
  'user',
  'bounce_guard',
  'complaint_guard',
  'provider_blocked',
  'materialize_timeout',
] as const;

export type KnownPauseReasonCode = (typeof PAUSE_REASON_CODES)[number];
export type PauseReasonCode = KnownPauseReasonCode | (string & {});

/**
 * Sloupec "kdo zapisuje" v registru kontraktu omezuje SENDER, ne kod. Aplikace smi
 * zapsat kteroukoliv hodnotu vcetne techto ctyr: vycerpanou kvotu detekuje i ona
 * z GetAccount. Kdo zapis provedl, se pozna z pole source, ne z hodnoty code.
 */
export const SENDER_PAUSE_REASON_CODES = [
  'render_failure_rate',
  'credentials_undecryptable',
  'provider_quota_exhausted',
  'provider_unavailable',
] as const;

export const pauseReasonSchema = z
  .object({
    code: z.string().min(1),
    source: z.enum(['sender', 'app', 'user']),
    detail: z.string().max(2000).optional(),
    sender_id: z.string().max(64).optional(),
    // ODCHYLKA OD PLÁNU: plán psal `z.string().datetime({ offset: false })`.
    // Repozitář jede na zodu 4, kde je ISO validace pod `z.iso`; starý tvar je
    // v tomhle vydání zrušený a schéma by se ani nesestavilo.
    at: z.iso.datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.sender_id !== undefined && v.source !== 'sender') {
      ctx.addIssue({
        code: 'custom',
        path: ['sender_id'],
        message: 'sender_id smí být vyplněné jen když source je sender',
      });
    }
  });

export type PauseReason = z.infer<typeof pauseReasonSchema>;

export function buildPauseReason(
  code: PauseReasonCode,
  source: 'sender' | 'app' | 'user',
  extra: { detail?: string; senderId?: string; at?: Date } = {},
): PauseReason {
  const at = (extra.at ?? new Date()).toISOString();
  return {
    code,
    source,
    at,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.senderId && source === 'sender' ? { sender_id: extra.senderId } : {}),
  };
}

/**
 * Audit campaign.auto_paused zapisuje aplikace i tehdy, kdyz pauzu provedl sender,
 * protoze sender do audit_log nema granty. Pauzy vyvolane uzivatelem to nepokryva,
 * ty uz ma campaign.status_changed se skutecnym akterem.
 */
export function isAutoPause(reason: PauseReason): boolean {
  return reason.code !== 'user';
}

/** Job campaign.resume_on_quota vybira podle code, nikdy podle source. */
export const AUTO_RESUMABLE_PAUSE_CODES = ['provider_quota_exhausted'] as const;
