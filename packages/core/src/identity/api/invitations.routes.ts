import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext, withWorkspace } from '../../tx';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../permissions';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '../invitation-service';
import { requireSession } from './auth.routes';
import { problemResponse, RoleSchema, IdempotencyHeaderSchema, type ApiEnv } from './schemas';

export const InvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: RoleSchema,
    expires_at: z.iso.datetime(),
    created_at: z.iso.datetime(),
  })
  .openapi('Invitation');

export const CreateInvitationInput = z
  .object({ email: z.email(), role: RoleSchema })
  .strict()
  .openapi('CreateInvitationInput');

export const AcceptInvitationInput = z
  .object({ token: z.string().min(1).max(200) })
  .strict()
  .openapi('AcceptInvitationInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/invitations',
  tags: ['Invitations'],
  summary: 'Čekající pozvánky projektu',
  security: [{ bearerAuth: ['members:read'] }],
  responses: {
    200: {
      description: 'Seznam pozvánek',
      content: { 'application/json': { schema: z.object({ data: z.array(InvitationSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/invitations',
  tags: ['Invitations'],
  summary: 'Pozvání do projektu',
  security: [{ bearerAuth: ['members:invite'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateInvitationInput } } },
  },
  responses: {
    201: {
      description: 'Pozvánka odeslána, token je jen v e-mailu',
      content: { 'application/json': { schema: z.object({ invitation: InvitationSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'already_exists', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
    // Instalace nemá čím pozvánku odeslat. Vrací se DŘÍV, než pozvánka vznikne.
    503: problemResponse('system_mail_unavailable'),
  },
});

const revokeRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/invitations/{id}',
  tags: ['Invitations'],
  summary: 'Revokace čekající pozvánky',
  security: [{ bearerAuth: ['members:invite'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Revokováno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const acceptRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/invitations/accept',
  tags: ['Invitations'],
  summary: 'Přijetí pozvánky přihlášeným uživatelem',
  description:
    'Neplatný, prošlý i použitý token vrací shodně 404, aby nešlo zjistit, jestli pozvánka existuje.',
  request: { body: { content: { 'application/json': { schema: AcceptInvitationInput } } } },
  responses: {
    200: {
      description: 'Členství založeno',
      content: {
        'application/json': {
          schema: z.object({
            workspace: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
            role: RoleSchema,
          }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerInvitationRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:read');
    const data = await withWorkspace(ctx, (tx) => listInvitations(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:invite');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')((tx) =>
      createInvitation(tx, ctx, { email: input.email, role: input.role }, label),
    );
    return c.json({ invitation: result.body } as never, result.status as never);
  });

  app.openapi(revokeRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:invite');
    await withWorkspace(ctx, (tx) => revokeInvitation(tx, ctx, c.req.valid('param').id, label));
    return c.body(null, 204);
  });

  app.openapi(acceptRouteDef, async (c) => {
    const actor = await requireSession(c);
    const [user] = await withoutContext((tx) =>
      tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, actor.userId))
        .limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');
    const result = await acceptInvitation({
      userId: actor.userId,
      userEmail: user.email,
      token: c.req.valid('json').token,
    });
    return c.json(result, 200);
  });
}
