import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import {
  deleteNameOverride,
  listNameOverrides,
  upsertNameOverride,
  type NameOverride,
} from '../repo/name-overrides';
import type { ContactsEnv } from './index';
import { IdParam, IsoDateTime, Uuid, problemResponse, toIsoRequired } from './schemas';

const TAG = 'Name overrides';

const NameOverrideSchema = z
  .object({
    id: Uuid,
    kind: z.enum(['first', 'last']),
    /** Klíč bez diakritiky a malými písmeny. Počítá ho server, klient ho neposílá. */
    name_key: z.string(),
    gender: z.enum(['female', 'male', 'unknown']).nullable(),
    vocative: z.string().nullable(),
    note: z.string().nullable(),
    created_at: IsoDateTime,
  })
  .openapi('NameOverride');

function present(row: NameOverride): z.infer<typeof NameOverrideSchema> {
  return {
    id: row.id,
    kind: row.kind,
    name_key: row.name_key,
    gender: row.gender,
    vocative: row.vocative,
    note: row.note,
    created_at: toIsoRequired(row.created_at),
  };
}

const listRoute = createRoute({
  method: 'get',
  path: '/name-overrides',
  tags: [TAG],
  summary: 'Přepisy jmen projektu',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: {
    query: z.object({
      kind: z.enum(['first', 'last']).optional(),
      q: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  },
  responses: {
    200: {
      description: 'Přepisy',
      content: {
        'application/json': { schema: z.object({ data: z.array(NameOverrideSchema) }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const createOverrideRoute = createRoute({
  method: 'post',
  path: '/name-overrides',
  tags: [TAG],
  summary: 'Založení nebo úprava přepisu jména',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              kind: z.enum(['first', 'last']).default('first'),
              /** Jméno v libovolném tvaru, klíč se z něj počítá na serveru. */
              name: z.string().min(1).max(100),
              gender: z.enum(['female', 'male', 'unknown']).nullable().optional(),
              vocative: z.string().max(100).nullable().optional(),
              note: z.string().max(500).nullable().optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Uloženo',
      content: { 'application/json': { schema: z.object({ id: Uuid }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const deleteOverrideRoute = createRoute({
  method: 'delete',
  path: '/name-overrides/{id}',
  tags: [TAG],
  summary: 'Smazání přepisu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerNameOverrideRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const rows = await listNameOverrides(ctx, c.req.valid('query'));
    return c.json({ data: rows.map(present) }, 200);
  });

  app.openapi(createOverrideRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const body = c.req.valid('json');
    const id = await upsertNameOverride(ctx, {
      kind: body.kind,
      name: body.name,
      gender: body.gender,
      vocative: body.vocative,
      note: body.note,
    });
    return c.json({ id }, 201);
  });

  app.openapi(deleteOverrideRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    if (!(await deleteNameOverride(ctx, c.req.valid('param').id))) {
      throw new ApiError('not_found');
    }
    return c.body(null, 204);
  });
}
