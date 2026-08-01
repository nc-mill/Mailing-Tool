import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '../../tx';
import { assertPermission } from '../permissions';
import { changeMemberRole, listMembers, removeMember } from '../membership-service';
import { problemResponse, RoleSchema, type ApiEnv } from './schemas';

export const MemberSchema = z
  .object({
    user_id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: RoleSchema,
    created_at: z.iso.datetime(),
  })
  .openapi('Member');

export const UpdateMemberInput = z
  .object({ role: RoleSchema })
  .strict()
  .openapi('UpdateMemberInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/members',
  tags: ['Members'],
  summary: 'Členové projektu',
  security: [{ bearerAuth: ['members:read'] }],
  responses: {
    200: {
      description: 'Seznam členů',
      content: { 'application/json': { schema: z.object({ data: z.array(MemberSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Změna role člena',
  security: [{ bearerAuth: ['members:update_role'] }],
  request: {
    params: z.object({ user_id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateMemberInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ member: MemberSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
    422: problemResponse('validation_failed'),
  },
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Odebrání člena z projektu',
  security: [{ bearerAuth: ['members:remove'] }],
  request: { params: z.object({ user_id: z.uuid() }) },
  responses: {
    204: { description: 'Odebráno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
  },
});

export function registerMemberRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:read');
    const data = await withWorkspace(ctx, (tx) => listMembers(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(updateRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:update_role');
    const member = await withWorkspace(ctx, (tx) =>
      changeMemberRole(
        tx,
        ctx,
        { userId: c.req.valid('param').user_id, role: c.req.valid('json').role },
        label,
      ),
    );
    return c.json({ member }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:remove');
    await withWorkspace(ctx, (tx) => removeMember(tx, ctx, c.req.valid('param').user_id, label));
    return c.body(null, 204);
  });
}
