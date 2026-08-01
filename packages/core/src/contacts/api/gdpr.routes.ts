import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { GDPR_REQUEST_TYPES, daysRemaining } from '../gdpr/request';
import { maskEmail } from '../email';
import { getContactById } from '../repo/contacts-query';
import {
  createGdprRequest,
  extendGdprRequest,
  findGdprRequest,
  listGdprRequests,
  processGdprRequest,
  rejectGdprRequest,
  verifyGdprRequest,
  type GdprRequestRecord,
} from '../repo/gdpr';
import type { ContactsEnv } from './index';
import {
  EmailInput,
  IdParam,
  IsoDateTime,
  Uuid,
  problemResponse,
  toIso,
  toIsoRequired,
} from './schemas';

const TAG = 'GDPR';

const GdprRequestSchema = z
  .object({
    id: Uuid,
    contact_id: Uuid.nullable(),
    /** Maskovaná adresa se skládá z kontaktu, když ještě existuje. Jinak je null. */
    masked_email: z.string().nullable(),
    type: z.enum(GDPR_REQUEST_TYPES),
    mode: z.enum(['anonymize', 'purge']).nullable(),
    status: z.string(),
    channel: z.string(),
    requested_at: IsoDateTime,
    due_at: IsoDateTime,
    extended_until: IsoDateTime.nullable(),
    days_remaining: z.number().int(),
    completed_at: IsoDateTime.nullable(),
    rejection_reason: z.string().nullable(),
  })
  .openapi('GdprRequest');

/**
 * Plaintext adresy se v odpovědi neobjeví NIKDY, ani u žádosti, která ještě běží.
 * Tabulka `gdpr_requests` ho ani neukládá: nese jen otisk. Maskovaná podoba se skládá
 * z kontaktu, dokud existuje; po výmazu už není z čeho a vrací se null.
 */
async function present(
  ctx: Parameters<typeof getContactById>[0],
  row: GdprRequestRecord,
): Promise<z.infer<typeof GdprRequestSchema>> {
  const contact = row.contact_id === null ? null : await getContactById(ctx, row.contact_id);
  const dueAt = row.due_at instanceof Date ? row.due_at : new Date(row.due_at);
  const extendedUntil =
    row.extended_until === null
      ? null
      : row.extended_until instanceof Date
        ? row.extended_until
        : new Date(row.extended_until);

  return {
    id: row.id,
    contact_id: row.contact_id,
    masked_email: contact === null ? null : maskEmail(contact.email),
    type: row.type,
    mode: row.mode,
    status: row.status,
    channel: row.channel,
    requested_at: toIsoRequired(row.requested_at),
    due_at: toIsoRequired(row.due_at),
    extended_until: toIso(row.extended_until),
    days_remaining: daysRemaining({ dueAt, extendedUntil }),
    completed_at: toIso(row.completed_at),
    rejection_reason: row.rejection_reason,
  };
}

const ReasonBody = z.object({ reason: z.string().min(1).max(1000) }).strict();

const listRoute = createRoute({
  method: 'get',
  path: '/gdpr-requests',
  tags: [TAG],
  summary: 'Žádosti subjektů, řazené podle lhůty',
  security: [{ bearerAuth: ['gdpr:export'] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      status: z
        .enum(['received', 'verifying', 'processing', 'completed', 'rejected', 'failed'])
        .optional(),
      type: z.enum(GDPR_REQUEST_TYPES).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Žádosti',
      content: { 'application/json': { schema: z.object({ data: z.array(GdprRequestSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const createRequestRoute = createRoute({
  method: 'post',
  path: '/gdpr-requests',
  tags: [TAG],
  summary: 'Založení žádosti subjektu údajů',
  security: [{ bearerAuth: ['gdpr:export'] }, { bearerAuth: ['gdpr:erase'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              email: EmailInput,
              type: z.enum(GDPR_REQUEST_TYPES),
              mode: z.enum(['anonymize', 'purge']).optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Žádost přijata ke zpracování',
      content: { 'application/json': { schema: GdprRequestSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/gdpr-requests/{id}',
  tags: [TAG],
  summary: 'Detail žádosti',
  security: [{ bearerAuth: ['gdpr:export'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Detail', content: { 'application/json': { schema: GdprRequestSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const verifyRoute = createRoute({
  method: 'post',
  path: '/gdpr-requests/{id}/verify',
  tags: [TAG],
  summary: 'Ověření totožnosti subjektu a spuštění zpracování',
  security: [{ bearerAuth: ['gdpr:export'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Ověřeno', content: { 'application/json': { schema: GdprRequestSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('invalid_state_transition'),
    422: problemResponse('validation_failed'),
  },
});

const extendRoute = createRoute({
  method: 'post',
  path: '/gdpr-requests/{id}/extend',
  tags: [TAG],
  summary: 'Prodloužení lhůty o dva měsíce, jen s důvodem',
  security: [{ bearerAuth: ['gdpr:export'] }],
  request: {
    params: IdParam,
    // Důvod je povinný: prodloužení lhůty se musí dát obhájit před dozorem.
    body: { content: { 'application/json': { schema: ReasonBody } } },
  },
  responses: {
    200: {
      description: 'Lhůta prodloužena',
      content: { 'application/json': { schema: GdprRequestSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('invalid_state_transition'),
    422: problemResponse('validation_failed'),
  },
});

const rejectRoute = createRoute({
  method: 'post',
  path: '/gdpr-requests/{id}/reject',
  tags: [TAG],
  summary: 'Zamítnutí žádosti, jen s důvodem',
  security: [{ bearerAuth: ['gdpr:export'] }],
  request: { params: IdParam, body: { content: { 'application/json': { schema: ReasonBody } } } },
  responses: {
    200: {
      description: 'Zamítnuto',
      content: { 'application/json': { schema: GdprRequestSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('invalid_state_transition'),
    422: problemResponse('validation_failed'),
  },
});

export function registerGdprRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'gdpr:export');
    const rows = await listGdprRequests(ctx, c.req.valid('query'));
    return c.json({ data: await Promise.all(rows.map((row) => present(ctx, row))) }, 200);
  });

  app.openapi(createRequestRoute, async (c) => {
    const { ctx } = c.get('auth');
    const body = c.req.valid('json');
    // Výmaz vyžaduje jiný scope než export: je to nevratná operace nad cizími daty.
    assertPermission(ctx, body.type === 'erasure' ? 'gdpr:erase' : 'gdpr:export');
    const created = await createGdprRequest(ctx, {
      email: body.email,
      type: body.type,
      ...(body.mode === undefined ? {} : { mode: body.mode }),
      channel: 'api',
    });
    const row = await findGdprRequest(ctx, created.id);
    if (row === null) throw new ApiError('not_found');
    // V odpovědi nikdy není plaintext adresy, jen maskovaná podoba.
    return c.json(await present(ctx, row), 202);
  });

  app.openapi(detailRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'gdpr:export');
    const row = await findGdprRequest(ctx, c.req.valid('param').id);
    if (row === null) throw new ApiError('not_found');
    return c.json(await present(ctx, row), 200);
  });

  app.openapi(verifyRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'gdpr:export');
    const { id } = c.req.valid('param');
    await verifyGdprRequest(ctx, id);
    // Ověření a spuštění jsou dva kroky domény, ale jedna akce uživatele: neověřená
    // žádost se nikdy neprovádí a ověřená nemá na co čekat.
    await processGdprRequest(ctx, id);
    const row = await findGdprRequest(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json(await present(ctx, row), 200);
  });

  app.openapi(extendRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'gdpr:export');
    const { id } = c.req.valid('param');
    await extendGdprRequest(ctx, id, c.req.valid('json').reason);
    const row = await findGdprRequest(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json(await present(ctx, row), 200);
  });

  app.openapi(rejectRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'gdpr:export');
    const { id } = c.req.valid('param');
    await rejectGdprRequest(ctx, id, c.req.valid('json').reason);
    const row = await findGdprRequest(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json(await present(ctx, row), 200);
  });
}
