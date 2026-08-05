import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import {
  deleteSenderIdentity,
  getSenderIdentity,
  listSenderIdentities,
  setDefaultSenderIdentity,
} from '../repo';
import {
  createSenderIdentityFromApi,
  presentSenderIdentity,
  updateSenderIdentityFromApi,
  type SenderIdentityInput,
} from '../service';
import type { SendersEnv } from './index';

/*
 * Tag je `Sending`, ne nový. Předvolba odesílatele patří k odesílacím účtům
 * a doménám do jedné kapitoly dokumentace; vlastní tag by tu kapitolu rozpůlil
 * a navíc by se musel dopsat do seznamu v `buildOpenApiDocument`.
 */
const TAG = 'Sending';

const Uuid = z.uuid();
const IdParam = z.object({ id: Uuid });

const SenderIdentitySchema = z
  .object({
    id: Uuid,
    name: z.string(),
    from_name: z.string(),
    from_email: z.string(),
    reply_to: z.string().nullable(),
    provider_id: Uuid,
    provider_name: z.string(),
    provider_status: z.string(),
    sender_domain_id: Uuid,
    domain: z.string(),
    domain_verified: z.boolean(),
    is_default: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('SenderIdentity');

/*
 * Tělo je pro založení i úpravu TOTOŽNÉ a posílá se vždy celé.
 *
 * Není to lenost, je to důsledek toho, co předvolba je: jedna sada pěti údajů,
 * které dávají smysl jen dohromady. Dílčí `PATCH` by uměl vyrobit stav, kdy
 * adresa už nepatří do domény, aniž by se domény kdokoli dotkl, a kontrola by
 * musela dopočítávat chybějící pole z databáze. Proto je i úprava `PUT`.
 *
 * `reply_to` je `nullable`, ne `optional`: prázdno je legitimní hodnota
 * („stačí adresa odesílatele"), takže se posílá jako `null`, ne vynecháním.
 */
const SenderIdentityRequest = z
  .object({
    name: z.string().min(1).max(120),
    from_name: z.string().min(1).max(200),
    from_email: z.email().max(254),
    reply_to: z.email().max(254).nullable(),
    provider_id: Uuid,
    sender_domain_id: Uuid,
    is_default: z.boolean().default(false),
  })
  .strict()
  .openapi('SenderIdentityRequest');

const listRoute = createRoute({
  method: 'get',
  path: '/senders',
  tags: [TAG],
  summary: 'Předvolby odesílatele',
  security: [{ bearerAuth: ['providers:read'] }],
  responses: {
    200: {
      description: 'Předvolby projektu, výchozí první',
      content: {
        'application/json': { schema: z.object({ data: z.array(SenderIdentitySchema) }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createSenderRoute = createRoute({
  method: 'post',
  path: '/senders',
  tags: [TAG],
  summary: 'Nová předvolba odesílatele',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { body: { content: { 'application/json': { schema: SenderIdentityRequest } } } },
  responses: {
    201: {
      description: 'Založeno',
      content: { 'application/json': { schema: SenderIdentitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const getSenderRoute = createRoute({
  method: 'get',
  path: '/senders/{id}',
  tags: [TAG],
  summary: 'Jedna předvolba',
  security: [{ bearerAuth: ['providers:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Předvolba',
      content: { 'application/json': { schema: SenderIdentitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const putSenderRoute = createRoute({
  method: 'put',
  path: '/senders/{id}',
  tags: [TAG],
  summary: 'Úprava předvolby',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SenderIdentityRequest } } },
  },
  responses: {
    200: {
      description: 'Uloženo',
      content: { 'application/json': { schema: SenderIdentitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteSenderRoute = createRoute({
  method: 'delete',
  path: '/senders/{id}',
  tags: [TAG],
  summary: 'Smazání předvolby',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const defaultSenderRoute = createRoute({
  method: 'post',
  path: '/senders/{id}/default',
  tags: [TAG],
  summary: 'Nastavení výchozí předvolby',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Nastaveno',
      content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

function toInput(body: z.infer<typeof SenderIdentityRequest>): SenderIdentityInput {
  return {
    name: body.name,
    from_name: body.from_name,
    from_email: body.from_email,
    reply_to: body.reply_to,
    provider_id: body.provider_id,
    sender_domain_id: body.sender_domain_id,
    is_default: body.is_default,
  };
}

export function registerSenderIdentityRoutes(app: OpenAPIHono<SendersEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const rows = await listSenderIdentities(ctx);
    return c.json({ data: rows.map(presentSenderIdentity) }, 200);
  });

  app.openapi(createSenderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    return c.json(await createSenderIdentityFromApi(ctx, toInput(c.req.valid('json'))), 201);
  });

  app.openapi(getSenderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const row = await getSenderIdentity(ctx, c.req.valid('param').id);
    if (!row) throw new ApiError('not_found');
    return c.json(presentSenderIdentity(row), 200);
  });

  app.openapi(putSenderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    return c.json(
      await updateSenderIdentityFromApi(ctx, c.req.valid('param').id, toInput(c.req.valid('json'))),
      200,
    );
  });

  app.openapi(deleteSenderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    if (!(await deleteSenderIdentity(ctx, c.req.valid('param').id))) {
      throw new ApiError('not_found');
    }
    return c.body(null, 204);
  });

  app.openapi(defaultSenderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    if (!(await setDefaultSenderIdentity(ctx, c.req.valid('param').id))) {
      throw new ApiError('not_found');
    }
    return c.json({ ok: true }, 200);
  });
}
