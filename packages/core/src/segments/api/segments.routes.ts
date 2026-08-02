import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import type { WorkspaceContext } from '../../identity/types';
import { SegmentAstV1, type SegmentAst } from '../ast';
import { audienceBreakdown } from '../audience';
import { diagnoseEmptyResult } from '../diagnostics';
import { SEGMENT_PRESETS, presetByKey, type PresetKey } from '../presets';
import { countSegment, listSegmentContacts } from '../repo';
import {
  createSegment,
  deleteSegment,
  freezeSegment,
  getSegment,
  listSegments,
  recountSegment,
  segmentFreshness,
  updateSegment,
  type SegmentRow,
} from '../service';
import { segmentJsonSchema } from './json-schema';
import {
  AudienceBreakdownRequest,
  AudienceBreakdownResponse,
  ContactSampleSchema,
  CreateSegmentRequest,
  PatchSegmentRequest,
  PresetItem,
  PreviewRequest,
  PreviewResponse,
  SegmentResponse,
  Uuid,
} from './schemas';
import type { SegmentsEnv } from './index';

const TAG = 'Segments';

/**
 * Časová zóna projektu. Požadavek 4.2 na P04 (`WorkspaceContext` nese `timezone`)
 * ke dni psaní splněný NENÍ, takže se bere táž výchozí hodnota jako v `repo.ts`.
 * Jakmile kontext zónu ponese, změní se to na jednom místě tady.
 */
const WORKSPACE_TIMEZONE = 'Europe/Prague';

const IdParam = z.object({ id: Uuid });

function present(row: SegmentRow): z.infer<typeof SegmentResponse> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    preset_key: row.presetKey,
    definition: row.definition,
    cached_count: row.cachedCount,
    cached_is_exact: row.cachedIsExact,
    cached_at: row.cachedAt === null ? null : row.cachedAt.toISOString(),
    cached_duration_ms: row.cachedDurationMs,
    recompute_state: row.recomputeState,
    last_error_code: row.lastErrorCode,
    freshness: segmentFreshness(row.cachedAt),
  };
}

/**
 * Úplná validace stromu podmínek. Definice cesty nese jen kořen (viz komentář
 * u `SegmentDefinitionSchema`), takže rekurzivní kontrola musí proběhnout tady.
 * Bez ní by se do kompilátoru dostal strom, který schéma nikdy neviděl.
 */
function parseDefinition(value: unknown): SegmentAst {
  const parsed = SegmentAstV1.safeParse(value);
  if (parsed.success) return parsed.data;
  // Vadný strom je chyba VOLAJÍCÍHO, tedy 422 s cestou k poli, ne 500.
  // Holá `parse()` vyhodí ZodError, kterou obálka chyb nezná, a klient místo
  // „tahle podmínka je špatně" dostane „interní chyba serveru".
  throw new ApiError('validation_failed', {
    errors: parsed.error.issues.map((issue) => ({
      path: ['definition', ...(issue.path ?? []).map((part) => String(part))].join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
}

async function loadDefinition(
  ctx: WorkspaceContext,
  body: { definition?: unknown; segment_id?: string | undefined },
): Promise<SegmentAst> {
  if (body.definition !== undefined) return parseDefinition(body.definition);
  if (body.segment_id === undefined) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'definition',
          code: 'required_field_missing',
          message: 'Náhled potřebuje definition, nebo segment_id.',
        },
      ],
    });
  }
  return (await getSegment(ctx, body.segment_id)).definition;
}

/* Statické cesty jsou PŘED `/segments/{id}`, jinak by je pohltil parametr. */

const schemaRoute = createRoute({
  method: 'get',
  path: '/segments/schema',
  tags: [TAG],
  summary: 'JSON Schema definice segmentu, verze 1',
  security: [{ bearerAuth: ['segments:read'] }],
  responses: {
    200: {
      description: 'JSON Schema AST verze 1',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const presetsRoute = createRoute({
  method: 'get',
  path: '/segments/presets',
  tags: [TAG],
  summary: 'Hotové segmenty čištění',
  security: [{ bearerAuth: ['segments:read'] }],
  responses: {
    200: {
      description: 'Šest presetů',
      content: { 'application/json': { schema: z.object({ items: z.array(PresetItem) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const usePresetRoute = createRoute({
  method: 'post',
  path: '/segments/presets/{key}',
  tags: [TAG],
  summary: 'Založení segmentu z presetu',
  security: [{ bearerAuth: ['segments:write'] }],
  request: {
    params: z.object({ key: z.string().min(1).max(64) }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: z.string().min(1).max(120), list_id: Uuid.optional() }).strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Vlastní kopie presetu',
      content: { 'application/json': { schema: SegmentResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const previewRoute = createRoute({
  method: 'post',
  path: '/segments/preview',
  tags: [TAG],
  summary: 'Počet, vzorek a varování bez uložení',
  security: [{ bearerAuth: ['segments:read'] }],
  /*
   * POŽADAVEK 4.3 NA P04, KE DNI PSANÍ NESPLNĚNÝ: middleware `rateLimit`
   * s rozsahem `user` (20 náhledů za minutu). Katalog pravidel v
   * `apps/web/src/lib/api/rate-limit.ts` je uzavřený výčet, který vlastní P04,
   * a doménový plán do něj sahat nesmí. Do doby, než pravidlo přibude, drží
   * frekvenci klient: builder debouncuje 500 ms a předchozí požadavek ruší
   * přes AbortController, takže každý stisk klávesy dotaz nespustí.
   */
  request: { body: { content: { 'application/json': { schema: PreviewRequest } } } },
  responses: {
    200: {
      description: 'Počet, vzorek a varování',
      content: { 'application/json': { schema: PreviewResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const breakdownRoute = createRoute({
  method: 'post',
  path: '/segments/audience-breakdown',
  tags: [TAG],
  summary: 'Rozpad publika po branách',
  security: [{ bearerAuth: ['segments:read'] }],
  request: { body: { content: { 'application/json': { schema: AudienceBreakdownRequest } } } },
  responses: {
    200: {
      description: 'Rozpad publika po branách',
      content: { 'application/json': { schema: AudienceBreakdownResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const listRoute = createRoute({
  method: 'get',
  path: '/segments',
  tags: [TAG],
  summary: 'Segmenty projektu',
  security: [{ bearerAuth: ['segments:read'] }],
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) },
  responses: {
    200: {
      description: 'Segmenty',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(SegmentResponse), has_more: z.boolean() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/segments',
  tags: [TAG],
  summary: 'Nový segment',
  security: [{ bearerAuth: ['segments:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateSegmentRequest } } } },
  responses: {
    201: { description: 'Založeno', content: { 'application/json': { schema: SegmentResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/segments/{id}',
  tags: [TAG],
  summary: 'Jeden segment',
  security: [{ bearerAuth: ['segments:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Segment', content: { 'application/json': { schema: SegmentResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/segments/{id}',
  tags: [TAG],
  summary: 'Úprava segmentu',
  security: [{ bearerAuth: ['segments:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchSegmentRequest } } },
  },
  responses: {
    200: { description: 'Upraveno', content: { 'application/json': { schema: SegmentResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/segments/{id}',
  tags: [TAG],
  summary: 'Smazání segmentu',
  security: [{ bearerAuth: ['segments:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const segmentPreviewRoute = createRoute({
  method: 'get',
  path: '/segments/{id}/preview',
  tags: [TAG],
  summary: 'Náhled uloženého segmentu',
  security: [{ bearerAuth: ['segments:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Náhled', content: { 'application/json': { schema: PreviewResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const contactsRoute = createRoute({
  method: 'get',
  path: '/segments/{id}/contacts',
  tags: [TAG],
  summary: 'Kontakty segmentu',
  security: [{ bearerAuth: ['segments:read'] }],
  request: {
    params: IdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: Uuid.optional(),
    }),
  },
  responses: {
    200: {
      description: 'Kontakty',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(ContactSampleSchema), has_more: z.boolean() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const recountRoute = createRoute({
  method: 'post',
  path: '/segments/{id}/recount',
  tags: [TAG],
  summary: 'Přepočet segmentu',
  security: [{ bearerAuth: ['segments:write'] }],
  request: { params: IdParam },
  responses: {
    202: {
      description: 'Přepočet zařazen',
      content: { 'application/json': { schema: SegmentResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const freezeRoute = createRoute({
  method: 'post',
  path: '/segments/{id}/freeze',
  tags: [TAG],
  summary: 'Zmrazení segmentu do statické kopie',
  security: [{ bearerAuth: ['segments:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': { schema: z.object({ name: z.string().min(1).max(120) }).strict() },
      },
    },
  },
  responses: {
    201: {
      description: 'Statický segment',
      content: { 'application/json': { schema: SegmentResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerSegmentRoutes(app: OpenAPIHono<SegmentsEnv>): void {
  app.openapi(schemaRoute, (c) => {
    assertPermission(c.get('auth').ctx, 'segments:read');
    return c.json(segmentJsonSchema(), 200);
  });

  app.openapi(presetsRoute, (c) => {
    assertPermission(c.get('auth').ctx, 'segments:read');
    return c.json(
      {
        items: SEGMENT_PRESETS.map((preset) => ({
          key: preset.key,
          label_key: preset.labelKey,
          explanation_key: preset.explanationKey,
          definition: preset.definition({}),
        })),
      },
      200,
    );
  });

  app.openapi(usePresetRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    const { key } = c.req.valid('param');
    const body = c.req.valid('json');
    const preset = SEGMENT_PRESETS.find((p) => p.key === key);
    if (preset === undefined) throw new ApiError('not_found');
    // Preset se KOPÍRUJE, neodkazuje. Sdílená definice by znamenala, že úprava
    // presetu v kódu tiše změní segment, který si uživatel pojmenoval po svém.
    const definition = presetByKey(key as PresetKey).definition(
      body.list_id === undefined ? {} : { listId: body.list_id },
    );
    const row = await createSegment(ctx, {
      name: body.name,
      definition,
      presetKey: preset.key,
    });
    return c.json(present(row), 201);
  });

  app.openapi(previewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    const body = c.req.valid('json');
    const ast = await loadDefinition(ctx, body);
    const asOf = new Date();
    const opts = { asOf, timezone: WORKSPACE_TIMEZONE };
    const counted = await countSegment(ctx, ast, opts);
    const limit = body.sample_limit ?? 20;
    const sample =
      limit === 0 ? { rows: [] } : await listSegmentContacts(ctx, ast, { limit }, opts);
    const diagnostics = counted.count === 0 ? await diagnoseEmptyResult(ctx, ast, opts) : null;
    return c.json(
      {
        count: counted.count,
        exact: counted.exact,
        duration_ms: counted.durationMs,
        sample: sample.rows,
        warnings: counted.warnings,
        diagnostics,
      },
      200,
    );
  });

  app.openapi(breakdownRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    const body = c.req.valid('json');
    const out = await audienceBreakdown(
      ctx,
      {
        ...(body.segment_ids === undefined ? {} : { segmentIds: body.segment_ids }),
        ...(body.list_ids === undefined ? {} : { listIds: body.list_ids }),
        ...(body.definition === undefined ? {} : { ast: parseDefinition(body.definition) }),
      },
      { asOf: new Date(), timezone: WORKSPACE_TIMEZONE },
    );
    return c.json({ input: out.input, gates: out.gates, will_send: out.willSend }, 200);
  });

  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    const { limit } = c.req.valid('query');
    const out = await listSegments(ctx, { limit });
    return c.json({ data: out.rows.map(present), has_more: out.hasMore }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    const body = c.req.valid('json');
    const row = await createSegment(ctx, {
      name: body.name,
      definition: parseDefinition(body.definition),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.preset_key === undefined ? {} : { presetKey: body.preset_key }),
    });
    return c.json(present(row), 201);
  });

  app.openapi(getRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    return c.json(present(await getSegment(ctx, c.req.valid('param').id)), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    const body = c.req.valid('json');
    const row = await updateSegment(ctx, c.req.valid('param').id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.definition === undefined ? {} : { definition: parseDefinition(body.definition) }),
    });
    return c.json(present(row), 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    await deleteSegment(ctx, c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(segmentPreviewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    const row = await getSegment(ctx, c.req.valid('param').id);
    const opts = { asOf: new Date(), timezone: WORKSPACE_TIMEZONE };
    const counted = await countSegment(ctx, row.definition, opts);
    const sample = await listSegmentContacts(ctx, row.definition, { limit: 20 }, opts);
    const diagnostics =
      counted.count === 0 ? await diagnoseEmptyResult(ctx, row.definition, opts) : null;
    return c.json(
      {
        count: counted.count,
        exact: counted.exact,
        duration_ms: counted.durationMs,
        sample: sample.rows,
        warnings: counted.warnings,
        diagnostics,
      },
      200,
    );
  });

  app.openapi(contactsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:read');
    const row = await getSegment(ctx, c.req.valid('param').id);
    const { limit, cursor } = c.req.valid('query');
    const out = await listSegmentContacts(ctx, row.definition, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    return c.json({ data: out.rows, has_more: out.hasMore }, 200);
  });

  app.openapi(recountRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    return c.json(present(await recountSegment(ctx, c.req.valid('param').id)), 202);
  });

  app.openapi(freezeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'segments:write');
    const row = await freezeSegment(ctx, c.req.valid('param').id, c.req.valid('json'));
    return c.json(present(row), 201);
  });
}
