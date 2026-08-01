import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { assertPermission } from '../../identity/permissions';
import {
  problemResponse,
  PaginationSchema,
  CountSchema,
  PaginationQuerySchema,
  type ApiEnv,
} from '../../identity/api/schemas';
import { AUDIT_ORDERS, countAuditLog, listAuditLog } from '../audit-query';
import { listDeliveries } from '../webhooks/delivery-query';

export const AuditEntrySchema = z
  .object({
    id: z.uuid(),
    action: z.string(),
    actor_type: z.enum(['user', 'api_key', 'system']),
    actor_id: z.uuid().nullable(),
    actor_label: z.string(),
    target_type: z.string().nullable(),
    target_id: z.uuid().nullable(),
    ip: z.string().nullable(),
    request_id: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.iso.datetime(),
  })
  .openapi('AuditEntry');

const AuditQuerySchema = PaginationQuerySchema.extend({
  action: z.string().optional(),
  actor_id: z.uuid().optional(),
  target_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

const listAuditRoute = createRoute({
  method: 'get',
  path: '/api/v1/audit-log',
  tags: ['Audit'],
  summary: 'Auditní log projektu',
  description:
    'Globální akce uživatele (přihlášení, změna hesla) tenhle endpoint nevrací, patří uživateli, ne projektu.',
  security: [{ bearerAuth: ['audit:read'] }],
  request: { query: AuditQuerySchema },
  responses: {
    200: {
      description: 'Stránka záznamů',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(AuditEntrySchema), pagination: PaginationSchema }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const countAuditRoute = createRoute({
  method: 'get',
  path: '/api/v1/audit-log/count',
  tags: ['Audit'],
  summary: 'Počet záznamů auditního logu se stejnými filtry',
  security: [{ bearerAuth: ['audit:read'] }],
  request: { query: AuditQuerySchema.omit({ limit: true, cursor: true, order: true }) },
  responses: {
    200: { description: 'Počet', content: { 'application/json': { schema: CountSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const DeliveryQuerySchema = PaginationQuerySchema.extend({
  endpoint_id: z.uuid().optional(),
  event_type: z.string().optional(),
  status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'abandoned']).optional(),
});

const listDeliveriesRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-deliveries',
  tags: ['Webhooks'],
  summary: 'Log doručení webhooků',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { query: DeliveryQuerySchema },
  responses: {
    200: {
      description: 'Stránka doručení',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.record(z.string(), z.unknown())),
            pagination: PaginationSchema,
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const countDeliveriesRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-deliveries/count',
  tags: ['Webhooks'],
  summary: 'Počet doručení se stejnými filtry',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { query: DeliveryQuerySchema.omit({ limit: true, cursor: true, order: true }) },
  responses: {
    200: { description: 'Počet', content: { 'application/json': { schema: CountSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Stránkovací pomocníky bydlí v apps/web, protože jsou to konvence HTTP vrstvy.
 * Definice cesty je v core (4.7), takže se sem předávají injektáží: aplikace je
 * nastaví jednou při skládání a graf závislostí zůstává nedotčený.
 */
export type PaginationDeps = {
  parseQuery: (
    query: { limit?: string | undefined; order?: string | undefined; cursor?: string | undefined },
    allowed: readonly string[],
  ) => { limit: number; order: string; cursor: { k: unknown[] } | null };
  buildPage: <T>(
    rows: T[],
    opts: { limit: number; order: string },
    keysOf: (row: T) => unknown[],
  ) => { data: T[]; pagination: unknown };
};

let deps: PaginationDeps | null = null;

export function setPaginationDeps(next: PaginationDeps): void {
  deps = next;
}

function requireDeps(): PaginationDeps {
  if (!deps) throw new Error('setPaginationDeps nebylo zavoláno při skládání aplikace.');
  return deps;
}

export function registerAuditRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listAuditRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'audit:read');
    const query = c.req.valid('query');
    const page = requireDeps().parseQuery(query, AUDIT_ORDERS);
    const rows = await withWorkspace(ctx, (tx) =>
      listAuditLog(tx, ctx, {
        limit: page.limit,
        order: page.order,
        cursor: page.cursor,
        action: query.action,
        actorId: query.actor_id,
        targetId: query.target_id,
        from: query.from,
        to: query.to,
      }),
    );
    return c.json(
      requireDeps().buildPage(rows, { limit: page.limit, order: page.order }, (r) => [
        r.created_at,
        r.id,
      ]) as never,
      200,
    );
  });

  app.openapi(countAuditRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'audit:read');
    const query = c.req.valid('query');
    const result = await withWorkspace(ctx, (tx) =>
      countAuditLog(tx, ctx, {
        action: query.action,
        actorId: query.actor_id,
        targetId: query.target_id,
        from: query.from,
        to: query.to,
      }),
    );
    return c.json(result, 200);
  });

  app.openapi(listDeliveriesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const query = c.req.valid('query');
    const page = requireDeps().parseQuery(query, ['created_at.desc']);
    const rows = await withWorkspace(ctx, (tx) =>
      listDeliveries(tx, ctx, {
        limit: page.limit,
        cursor: page.cursor,
        endpointId: query.endpoint_id,
        eventType: query.event_type,
        status: query.status,
      }),
    );
    return c.json(
      requireDeps().buildPage(rows, { limit: page.limit, order: page.order }, (r) => [
        r.created_at,
        r.id,
      ]) as never,
      200,
    );
  });

  app.openapi(countDeliveriesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const query = c.req.valid('query');
    const rows = await withWorkspace(ctx, (tx) =>
      listDeliveries(tx, ctx, {
        limit: 10_000,
        cursor: null,
        endpointId: query.endpoint_id,
        eventType: query.event_type,
        status: query.status,
      }),
    );
    return c.json(
      {
        count: rows.length,
        precision: 'exact' as const,
        computed_at: new Date().toISOString(),
        stale: false,
      },
      200,
    );
  });
}
