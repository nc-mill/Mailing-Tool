import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse, IdempotencyHeaderSchema, type ApiEnv } from '../../identity/api/schemas';
import {
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  listEndpoints,
  updateEndpoint,
} from '../webhooks/endpoint-service';
import { enableEndpoint } from '../webhooks/disable';
import { emitWebhookEvent } from '../webhooks/emit';
import { retryDelivery } from '../webhooks/delivery-query';

export const WebhookEndpointSchema = z
  .object({
    id: z.uuid(),
    url: z.url(),
    description: z.string(),
    event_types: z.array(z.string()).min(1).max(50),
    status: z.enum(['active', 'disabled']),
    disabled_reason: z.string().nullable(),
    consecutive_failures: z.number().int(),
    last_success_at: z.iso.datetime().nullable(),
    last_failure_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('WebhookEndpoint');

export const WebhookDeliverySchema = z
  .object({
    id: z.uuid(),
    endpoint_id: z.uuid(),
    event_id: z.uuid(),
    event_type: z.string(),
    status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'abandoned']),
    attempt: z.number().int(),
    next_attempt_at: z.iso.datetime().nullable(),
    response_status: z.number().int().nullable(),
    response_body_snippet: z.string().nullable(),
    duration_ms: z.number().int().nullable(),
    error_code: z.string().nullable(),
    delivered_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('WebhookDelivery');

export const CreateWebhookEndpointInput = z
  .object({
    url: z.url(),
    description: z.string().max(500).optional(),
    event_types: z.array(z.string().min(1).max(100)).min(1).max(50),
  })
  .strict()
  .openapi('CreateWebhookEndpointInput');

export const UpdateWebhookEndpointInput = z
  .object({
    url: z.url().optional(),
    description: z.string().max(500).optional(),
    event_types: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  })
  .strict()
  .openapi('UpdateWebhookEndpointInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-endpoints',
  tags: ['Webhooks'],
  summary: 'Seznam odchozích webhooků',
  security: [{ bearerAuth: ['webhooks:read'] }],
  responses: {
    200: {
      description: 'Seznam',
      content: {
        'application/json': { schema: z.object({ data: z.array(WebhookEndpointSchema) }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const getRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Detail webhooku',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'Detail',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints',
  tags: ['Webhooks'],
  summary: 'Vytvoření webhooku, secret je v odpovědi jednou',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateWebhookEndpointInput } } },
  },
  responses: {
    201: {
      description: 'Vytvořeno',
      content: {
        'application/json': {
          schema: z.object({ endpoint: WebhookEndpointSchema, secret: z.string() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Změna webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateWebhookEndpointInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Smazání webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const enableRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints/{id}/enable',
  tags: ['Webhooks'],
  summary: 'Znovuaktivace deaktivovaného webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      description: 'Aktivováno',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const testRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints/{id}/test',
  tags: ['Webhooks'],
  summary: 'Odeslání testovací události ping',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    202: {
      description: 'Zařazeno k doručení',
      content: { 'application/json': { schema: z.object({ event_id: z.uuid() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const retryRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-deliveries/{id}/retry',
  tags: ['Webhooks'],
  summary: 'Ruční opakování doručení',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    202: { description: 'Zařazeno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerWebhookEndpointRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const data = await withWorkspace(ctx, (tx) => listEndpoints(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(getRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const endpoint = await withWorkspace(ctx, (tx) =>
      getEndpoint(tx, ctx, c.req.valid('param').id),
    );
    return c.json({ endpoint }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')((tx) => createEndpoint(tx, ctx, input, label));
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(updateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const endpoint = await withWorkspace(ctx, (tx) =>
      updateEndpoint(tx, ctx, c.req.valid('param').id, c.req.valid('json'), label),
    );
    return c.json({ endpoint }, 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    await withWorkspace(ctx, (tx) => deleteEndpoint(tx, ctx, c.req.valid('param').id, label));
    return c.body(null, 204);
  });

  app.openapi(enableRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const ok = await enableEndpoint(ctx, c.req.valid('param').id);
    if (!ok) throw new ApiError('not_found');
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(testRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const id = c.req.valid('param').id;
    const eventId = await withWorkspace(ctx, async (tx) => {
      await getEndpoint(tx, ctx, id);
      return emitWebhookEvent(tx, {
        workspaceId: ctx.workspaceId,
        type: 'ping',
        occurredAt: new Date(),
        data: { endpoint_id: id },
      });
    });
    return c.json({ event_id: eventId }, 202);
  });

  app.openapi(retryRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    await withWorkspace(ctx, (tx) => retryDelivery(tx, ctx, c.req.valid('param').id));
    return c.body(null, 202);
  });
}
