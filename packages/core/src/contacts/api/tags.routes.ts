import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError, validationFailed } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import {
  bulkTagContacts,
  createTag,
  deleteTag,
  getTag,
  listTagsPage,
  mergeTags,
  updateTag,
  type TagWithCount,
} from '../repo/tags';
import type { ContactsEnv } from './index';
import {
  IdParam,
  IdempotencyHeaderSchema,
  IsoDateTime,
  Uuid,
  cursorQuery,
  paginated,
  problemResponse,
  toIsoRequired,
} from './schemas';

const TAG = 'Tags';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const TagSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    color: z.string().nullable(),
    contact_count: z.number().int().nonnegative(),
    created_at: IsoDateTime,
  })
  .openapi('Tag');

const TagBody = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().regex(HEX_COLOR, { message: 'invalid_format' }).nullable().optional(),
  })
  .strict()
  .openapi('TagInput');

const TagPage = paginated(TagSchema, 'TagPage');
const ListQuery = cursorQuery(['name.asc', 'created_at.desc'], 'name.asc').extend({
  q: z.string().max(80).optional(),
});

function present(row: TagWithCount): z.infer<typeof TagSchema> {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    contact_count: row.contact_count,
    created_at: toIsoRequired(row.created_at),
  };
}

/**
 * Hromadné přiřazení štítků.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ DOMÉNOU. Plán posílal celý filtr seznamu kontaktů
 * (`q`, `status`, `segment_id`). `bulkTagContacts` umí jen výčet id, protože jen nad ním
 * jde spolehlivě spočítat, kdy se má operace přesunout do fronty. Filtr by tedy klient
 * poslal a server by ho tiše ignoroval, což je horší než ho nepřijmout: klient si vybere
 * v seznamu a pošle id, která už má.
 */
const BulkTagBody = z
  .object({
    filter: z.object({ contact_ids: z.array(Uuid).min(1).max(10000) }).strict(),
    add: z.array(Uuid).max(50).default([]),
    remove: z.array(Uuid).max(50).default([]),
  })
  .strict()
  .refine((value) => value.add.length + value.remove.length > 0, {
    message: 'required_field_missing',
    path: ['add'],
  })
  .openapi('BulkTagRequest');

const listRoute = createRoute({
  method: 'get',
  path: '/tags',
  tags: [TAG],
  summary: 'Stránka štítků i s počtem kontaktů',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: ListQuery },
  responses: {
    200: { description: 'Stránka štítků', content: { 'application/json': { schema: TagPage } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const createTagRoute = createRoute({
  method: 'post',
  path: '/tags',
  tags: [TAG],
  summary: 'Založení štítku',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { body: { content: { 'application/json': { schema: TagBody } } } },
  responses: {
    201: {
      description: 'Štítek vytvořen',
      content: { 'application/json': { schema: z.object({ data: TagSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed', 'too_many_items'),
  },
});

const patchTagRoute = createRoute({
  method: 'patch',
  path: '/tags/{id}',
  tags: [TAG],
  summary: 'Přejmenování štítku nebo změna barvy',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TagBody.partial() } } },
  },
  responses: {
    200: {
      description: 'Štítek upraven',
      content: { 'application/json': { schema: z.object({ data: TagSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const deleteTagRoute = createRoute({
  method: 'delete',
  path: '/tags/{id}',
  tags: [TAG],
  summary: 'Smazání štítku, kontakty zůstávají',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Štítek smazán' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const mergeTagRoute = createRoute({
  method: 'post',
  path: '/tags/{id}/merge',
  tags: [TAG],
  summary: 'Sloučení štítku do cílového',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: z.object({ into_tag_id: Uuid }).strict() } } },
  },
  responses: {
    200: {
      description: 'Štítky sloučeny',
      content: { 'application/json': { schema: z.object({ moved: z.number().int() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const bulkTagRoute = createRoute({
  method: 'post',
  path: '/contacts/tags:bulk',
  tags: [TAG],
  summary: 'Hromadné přiřazení a odebrání štítků',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: BulkTagBody } } },
  },
  responses: {
    200: {
      description: 'Provedeno synchronně',
      content: {
        'application/json': {
          schema: z.object({
            mode: z.literal('sync'),
            tagged: z.number().int(),
            untagged: z.number().int(),
          }),
        },
      },
    },
    202: {
      description: 'Operace zařazena do fronty',
      content: { 'application/json': { schema: z.object({ mode: z.literal('queued') }) } },
    },
    400: problemResponse('validation_failed'),
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

export function registerTagRoutes(app: OpenAPIHono<ContactsEnv>): void {
  // Cesta se statickým posledním segmentem se registruje dřív než /tags/{id},
  // aby ji router neposlal do parametru.
  app.openapi(bulkTagRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const body = c.req.valid('json');
    // Nad deseti tisíci kontakty jde přiřazení do fronty contacts.bulk_tag a vrací 202.
    const result = await bulkTagContacts(ctx, {
      filter: { ids: body.filter.contact_ids },
      add: body.add,
      remove: body.remove,
    });
    return result.mode === 'queued'
      ? c.json({ mode: 'queued' as const }, 202)
      : c.json({ mode: 'sync' as const, tagged: result.tagged, untagged: result.untagged }, 200);
  });

  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const query = c.req.valid('query');
    const page = await listTagsPage(ctx, query);
    return c.json(
      {
        data: page.rows.map(present),
        pagination: {
          next_cursor: page.nextCursor,
          prev_cursor: null,
          has_more: page.hasMore,
          limit: query.limit,
        },
      },
      200,
    );
  });

  app.openapi(createTagRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const body = c.req.valid('json');
    const { id } = await createTag(ctx, {
      name: body.name,
      ...(body.color === undefined || body.color === null ? {} : { color: body.color }),
    });
    const row = await getTag(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: present(row) }, 201);
  });

  app.openapi(patchTagRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    const updated = await updateTag(ctx, id, c.req.valid('json'));
    if (!updated) throw new ApiError('not_found');
    const row = await getTag(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: present(row) }, 200);
  });

  app.openapi(deleteTagRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    if (!(await deleteTag(ctx, c.req.valid('param').id))) throw new ApiError('not_found');
    return c.body(null, 204);
  });

  app.openapi(mergeTagRoute, async (c) => {
    const { ctx } = c.get('auth');
    const { id } = c.req.valid('param');
    const { into_tag_id: intoTagId } = c.req.valid('json');
    assertPermission(ctx, 'contacts:write');
    // Sloučení do sebe sama by smazalo štítek a nechalo kontakty bez něj. Chytáme to tady,
    // protože zod refine nemá přístup k parametru cesty.
    if (id === intoTagId) {
      throw validationFailed([
        {
          path: 'into_tag_id',
          code: 'invalid_value',
          message: 'Štítek nejde sloučit sám do sebe.',
        },
      ]);
    }
    const source = await getTag(ctx, id);
    if (source === null) throw new ApiError('not_found');
    await mergeTags(ctx, id, intoTagId);
    return c.json({ moved: source.contact_count }, 200);
  });
}
