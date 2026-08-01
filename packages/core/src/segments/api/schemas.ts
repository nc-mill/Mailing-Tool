import { z } from '@hono/zod-openapi';

export const Uuid = z.uuid();

/**
 * Tvar definice pro OpenAPI, NE pro validaci.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ SPUŠTĚNÍM: plán dával do definic cest přímo
 * `SegmentAstV1`. Ověřeno spuštěním generátoru, že to nejde: `GroupNodeSchema`
 * je rekurzivní `z.lazy` a `@asteasolutions/zod-to-openapi` 8.5.0 na něm
 * skončí na `RangeError: Maximum call stack size exceeded`, takže by se
 * `openapi.json` vůbec nevygeneroval. Dokument proto odkazuje na kompletní
 * JSON Schema z `GET /api/v1/segments/schema` a tady je jen kořen.
 *
 * Validace se tím NEOSLABUJE: každý handler, který definici přijímá, ji před
 * použitím prožene `SegmentAstV1.parse()`, takže neplatný strom skončí na 422
 * úplně stejně jako dřív. Hlídá to test v `apps/web/test/segments/routes.test.ts`.
 */
export const SegmentDefinitionSchema = z
  .object({ version: z.literal(1), root: z.unknown() })
  .openapi('SegmentDefinition', {
    description: 'Strom podmínek. Úplné schéma vrací GET /api/v1/segments/schema.',
  });

export const SegmentResponse = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string().nullable(),
    kind: z.enum(['dynamic', 'static']),
    preset_key: z.string().nullable(),
    definition: z.unknown(),
    cached_count: z.number().int().nullable(),
    cached_is_exact: z.boolean().nullable(),
    cached_at: z.string().nullable(),
    cached_duration_ms: z.number().int().nullable(),
    recompute_state: z.enum(['idle', 'queued', 'running', 'error']),
    last_error_code: z.string().nullable(),
    freshness: z.enum(['never', 'fresh', 'recent', 'stale']),
  })
  .openapi('Segment');

export const CreateSegmentRequest = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    definition: SegmentDefinitionSchema,
    preset_key: z.string().max(64).optional(),
  })
  .strict()
  .openapi('CreateSegment');

export const PatchSegmentRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    definition: SegmentDefinitionSchema.optional(),
  })
  .strict()
  .openapi('PatchSegment');

/**
 * Náhled bere BUĎ hotovou definici (builder, kde segment ještě neexistuje),
 * NEBO id uloženého segmentu. Obojí naráz je chyba volajícího, ne dvě cesty
 * k témuž: kdyby se posílalo obojí, nebylo by jasné, co má vyhrát.
 */
export const PreviewRequest = z
  .object({
    definition: SegmentDefinitionSchema.optional(),
    segment_id: Uuid.optional(),
    sample_limit: z.number().int().min(0).max(20).optional(),
  })
  .strict()
  .openapi('SegmentPreviewRequest');

export const ContactSampleSchema = z
  .object({
    id: Uuid,
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .openapi('SegmentContactSample');

export const PreviewResponse = z
  .object({
    count: z.number().int(),
    exact: z.boolean(),
    duration_ms: z.number().int(),
    sample: z.array(ContactSampleSchema),
    warnings: z.array(z.string()),
    /**
     * Diagnostika se počítá JEN u prázdného výsledku, jinak je `null`.
     * Dodatečné dotazy tak nikoho nezpomalují a klient pozná rozdíl mezi
     * „nepočítalo se" a „počítalo se a nic nenašlo" podle počtu, ne podle
     * chybějícího klíče.
     */
    diagnostics: z.unknown().nullable(),
  })
  .openapi('SegmentPreview');

export const PresetItem = z
  .object({
    key: z.string(),
    label_key: z.string(),
    explanation_key: z.string(),
    definition: z.unknown(),
  })
  .openapi('SegmentPreset');

export const AudienceBreakdownRequest = z
  .object({
    segment_ids: z.array(Uuid).optional(),
    list_ids: z.array(Uuid).optional(),
    definition: SegmentDefinitionSchema.optional(),
  })
  .strict()
  .openapi('AudienceBreakdownRequest');

export const AudienceBreakdownResponse = z
  .object({
    input: z.number().int(),
    gates: z.array(z.object({ key: z.string(), count: z.number().int() })),
    will_send: z.number().int(),
  })
  .openapi('AudienceBreakdown');
