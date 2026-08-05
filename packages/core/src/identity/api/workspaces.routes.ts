import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../permissions';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  restoreWorkspace,
  transferOwnership,
  updateWorkspace,
} from '../workspace-service';
import { requireSession } from './auth.routes';
import { problemResponse, RoleSchema, IdempotencyHeaderSchema, type ApiEnv } from './schemas';

export const WorkspaceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    slug: z.string(),
    locale: z.string(),
    timezone: z.string(),
    address_form: z.enum(['formal', 'informal']),
    /** Řeší projekt oslovení a 5. pád? Vypnuto skryje i volbu `address_form`. */
    greeting_enabled: z.boolean(),
    created_at: z.iso.datetime(),
    deleted_at: z.iso.datetime().nullable(),
  })
  .openapi('Workspace');

export const CreateWorkspaceInput = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(63).optional(),
    locale: z.string().max(20).optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict()
  .openapi('CreateWorkspaceInput');

export const UpdateWorkspaceInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(63).optional(),
    locale: z.string().max(20).optional(),
    timezone: z.string().max(64).optional(),
    address_form: z.enum(['formal', 'informal']).optional(),
    greeting_enabled: z.boolean().optional(),
  })
  .strict()
  .openapi('UpdateWorkspaceInput');

export const DeleteWorkspaceInput = z
  .object({ confirm_name: z.string().min(1).max(200) })
  .strict()
  .openapi('DeleteWorkspaceInput');

export const TransferOwnershipInput = z
  .object({ user_id: z.uuid() })
  .strict()
  .openapi('TransferOwnershipInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces',
  tags: ['Workspaces'],
  summary: 'Projekty, ve kterých má aktér členství',
  responses: {
    200: {
      description: 'Seznam projektů',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(WorkspaceSchema.extend({ role: RoleSchema })) }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces',
  tags: ['Workspaces'],
  summary: 'Založení projektu, zakladatel se stává ownerem',
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateWorkspaceInput } } },
  },
  responses: {
    201: {
      description: 'Založeno',
      content: {
        'application/json': { schema: z.object({ workspace: WorkspaceSchema, role: RoleSchema }) },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});

const getRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Detail projektu',
  security: [{ bearerAuth: ['workspace:read'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'Projekt',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Změna nastavení projektu',
  security: [{ bearerAuth: ['workspace:update'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateWorkspaceInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Měkké smazání projektu, obnovitelné 30 dní',
  security: [{ bearerAuth: ['workspace:delete'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: DeleteWorkspaceInput } } },
  },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const restoreRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{id}/restore',
  tags: ['Workspaces'],
  summary: 'Obnova smazaného projektu do 30 dnů',
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      description: 'Obnoveno',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
  },
});

const transferRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{id}/transfer-ownership',
  tags: ['Workspaces'],
  summary: 'Předání vlastnictví, vyžaduje hlavičku X-Reauth-Password',
  security: [{ bearerAuth: ['workspace:transfer'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema.extend({ 'x-reauth-password': z.string().min(1).optional() }),
    body: { content: { 'application/json': { schema: TransferOwnershipInput } } },
  },
  responses: {
    200: {
      description: 'Předáno',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerWorkspaceRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const actor = await requireSession(c);
    return c.json({ data: await listWorkspaces(actor.userId) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    const result = await createWorkspace(actor.userId, '', input);
    return c.json(result, 201);
  });

  app.openapi(getRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'workspace:read');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    const workspace = await withWorkspace(ctx, (tx) => getWorkspace(tx, ctx));
    return c.json({ workspace }, 200);
  });

  app.openapi(updateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:update');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    const workspace = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, c.req.valid('json'), label),
    );
    return c.json({ workspace }, 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:delete');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    await withWorkspace(ctx, (tx) =>
      deleteWorkspace(tx, ctx, c.req.valid('json').confirm_name, label),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreRouteDef, async (c) => {
    const actor = await requireSession(c);
    const workspace = await restoreWorkspace(
      { userId: actor.userId, workspaceId: c.req.valid('param').id },
      '',
    );
    return c.json({ workspace }, 200);
  });

  app.openapi(transferRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:transfer');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    if (ctx.actor.type !== 'user') throw new ApiError('forbidden');
    await transferOwnership(ctx, {
      currentUserId: ctx.actor.userId,
      targetUserId: c.req.valid('json').user_id,
      reauthPassword: c.req.header('X-Reauth-Password') ?? null,
      actorLabel: label,
    });
    return c.json({ ok: true as const }, 200);
  });
}
