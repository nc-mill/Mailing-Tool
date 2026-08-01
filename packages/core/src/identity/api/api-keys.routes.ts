import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { assertPermission, PERMISSIONS } from '../permissions';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  MAX_GRACE_SECONDS,
} from '../api-key-service';
import { problemResponse, IdempotencyHeaderSchema, type ApiEnv } from './schemas';

export const ApiKeySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    kind: z.enum(['secret', 'public']),
    // 8 znaků u secret, 16 u public, viz 3.5.
    prefix: z.string().regex(/^[a-z2-7]{8}$|^[a-z2-7]{16}$/),
    scopes: z.array(z.enum(PERMISSIONS)),
    last_used_at: z.iso.datetime().nullable(),
    expires_at: z.iso.datetime().nullable(),
    revoked_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('ApiKey');

/** Jediné místo v celém API, kde se sekret objeví. Nikde jinde už nikdy. */
export const ApiKeyWithSecretSchema = z
  .object({ key: ApiKeySchema, secret: z.string() })
  .openapi('ApiKeyWithSecret');

export const CreateApiKeyInput = z
  .object({
    name: z.string().min(1).max(100),
    kind: z.enum(['secret', 'public']).default('secret'),
    scopes: z.array(z.string()).max(PERMISSIONS.length),
    expires_at: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .openapi('CreateApiKeyInput');

export const RotateApiKeyInput = z
  .object({ grace_seconds: z.number().int().min(0).max(MAX_GRACE_SECONDS).default(0) })
  .strict()
  .openapi('RotateApiKeyInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/api-keys',
  tags: ['API keys'],
  summary: 'Seznam klíčů projektu, nikdy se sekretem',
  security: [{ bearerAuth: ['api_keys:read'] }],
  responses: {
    200: {
      description: 'Seznam klíčů',
      content: { 'application/json': { schema: z.object({ data: z.array(ApiKeySchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/api-keys',
  tags: ['API keys'],
  summary: 'Vytvoření klíče',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateApiKeyInput } } },
  },
  responses: {
    201: {
      description: 'Vytvořeno',
      content: { 'application/json': { schema: ApiKeyWithSecretSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('idempotency_key_reuse', 'idempotency_request_in_progress'),
    422: problemResponse('validation_failed'),
  },
});

const rotateRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/api-keys/{id}/rotate',
  tags: ['API keys'],
  summary: 'Rotace sekretu s volitelným grace obdobím',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: RotateApiKeyInput } } },
  },
  responses: {
    200: {
      description: 'Rotováno',
      content: { 'application/json': { schema: ApiKeyWithSecretSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});

const revokeRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/api-keys/{id}',
  tags: ['API keys'],
  summary: 'Revokace klíče, okamžitá a nevratná',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Revokováno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerApiKeyRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'api_keys:read');
    const data = await withWorkspace(ctx, (tx) => listApiKeys(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')(async (tx) =>
      createApiKey(
        tx,
        ctx,
        {
          name: input.name,
          kind: input.kind,
          scopes: input.scopes,
          expires_at: input.expires_at ?? null,
        },
        label,
      ),
    );
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(rotateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    // Rotace je POST, ale nový zdroj nevytváří, takže 200, ne 201.
    const result = await c.get('runIdempotent')(
      async (tx) => rotateApiKey(tx, ctx, { id, graceSeconds: input.grace_seconds }, label),
      { successStatus: 200 },
    );
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(revokeRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const { id } = c.req.valid('param');
    await withWorkspace(ctx, (tx) => revokeApiKey(tx, ctx, id, label));
    return c.body(null, 204);
  });
}
