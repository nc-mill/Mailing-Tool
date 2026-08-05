import { z } from 'zod';
import { EVENT_NAME_RE } from '../types';

/**
 * Schéma přijímané dávky a verzování payloadu, viz plán P10 Task 22.
 *
 * Pole `v` má dlouhý dosah: SDK se distribuuje i jako npm balíček a jednou
 * zabundlovaná verze na cizím webu žije roky a nikdo ji neaktualizuje.
 * Podpora verze 1 proto NEMÁ časové omezení a nová verze se zavádí ADITIVNĚ
 * vedle staré, nikdy místo ní.
 *
 * Chybějící `v` se chová jako neznámé. Nedoplňuje se výchozí hodnota, protože
 * „chybí" a „je jedna" nejsou totéž a tiché doplnění by skrylo rozbitý build
 * u zákazníka.
 */
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_IMPORT_EVENTS_PER_BATCH = 1000;

export const SUPPORTED_PAYLOAD_VERSIONS = [1] as const;

/**
 * ODCHYLKA OD PLÁNU, vynucená verzí knihovny. Plán psal
 * `z.string().datetime({ offset: false })`. Zod 4 tuhle metodu přesunul do
 * `z.iso.datetime()`; starý zápis by se přeložil, ale za běhu by spadl na
 * neexistující metodě. Chování je totéž: ISO 8601 v UTC, bez posunu.
 */
const isoDateTime = z.iso.datetime();

export const EventPageSchema = z
  .object({
    url: z.string().max(2048),
    path: z.string().max(1024),
    title: z.string().max(512).optional(),
    referrer: z.string().max(2048).optional(),
    search: z.string().max(1024).optional(),
  })
  .strict();

export const EventContextSchema = z
  .object({
    locale: z.string().max(35).optional(),
    timezone: z.string().max(64).optional(),
    screen: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional(),
    viewport: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional(),
    device: z.enum(['mobile', 'tablet', 'desktop', 'unknown']).optional(),
    os: z.string().max(32).optional(),
    browser: z.string().max(32).optional(),
    sdk: z
      .object({ name: z.literal('ml-web'), version: z.string().max(32) })
      .strict()
      .optional(),
    campaign: z
      .object({
        source: z.string().max(255).optional(),
        medium: z.string().max(255).optional(),
        campaign: z.string().max(255).optional(),
        content: z.string().max(255).optional(),
        term: z.string().max(255).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const IngestEventSchema = z
  .object({
    id: z.uuid(),
    name: z.string().regex(EVENT_NAME_RE),
    occurred_at: isoDateTime,
    session_id: z.uuid().optional(),
    page: EventPageSchema.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    context: EventContextSchema.optional(),
  })
  .strict();

export const IngestBatchSchema = z
  .object({
    v: z.number().int(),
    key: z.string().min(1).max(64),
    sent_at: isoDateTime,
    anonymous_id: z.string().optional(),
    events: z.array(IngestEventSchema).min(1),
  })
  .strict();

export type IngestBatch = z.infer<typeof IngestBatchSchema>;
export type IngestEvent = z.infer<typeof IngestEventSchema>;

export type ParseBatchResult =
  | { ok: true; batch: IngestBatch }
  | { ok: false; code: string; status: number; params?: Record<string, unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pořadí kontrol je záměrné: verze payloadu se posuzuje dřív než tvar, protože
 * při neznámé verzi nemá smysl vytýkat pole, která v ní možná nejsou.
 */
export function parseBatch(input: unknown): ParseBatchResult {
  const version = (input as { v?: unknown } | null)?.v;
  if (typeof version !== 'number' || !SUPPORTED_PAYLOAD_VERSIONS.includes(version as 1)) {
    return {
      ok: false,
      code: 'tracking_payload_version_unsupported',
      status: 400,
      params: { supported: [...SUPPORTED_PAYLOAD_VERSIONS] },
    };
  }

  const events = (input as { events?: unknown }).events;
  if (Array.isArray(events) && events.length > MAX_EVENTS_PER_BATCH) {
    return {
      ok: false,
      code: 'too_many_items',
      status: 422,
      params: { limit: MAX_EVENTS_PER_BATCH },
    };
  }

  const anonymousId = (input as { anonymous_id?: unknown }).anonymous_id;
  if (
    anonymousId !== undefined &&
    (typeof anonymousId !== 'string' || !UUID_RE.test(anonymousId))
  ) {
    return { ok: false, code: 'tracking_invalid_anonymous_id', status: 422 };
  }

  const parsed = IngestBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation_failed', status: 422 };

  return { ok: true, batch: parsed.data };
}
