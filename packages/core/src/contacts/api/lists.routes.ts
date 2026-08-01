import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError, validationFailed } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { DEFAULT_CONFIRMATION_MODE, DEFAULT_CONFIRMATION_TTL_HOURS } from '../constants';
import { resendConfirmation, subscribeToList } from '../lists/subscribe-service';
import { unsubscribe } from '../lists/unsubscribe';
import { findContactByEmail } from '../repo/contacts-query';
import {
  archive as archiveList,
  byId as listById,
  create as createList,
  list as listAll,
  setDefault,
  stats as listStats,
  update as updateList,
  type ListRow,
} from '../repo/lists';
import type { ContactsEnv } from './index';
import {
  EmailInput,
  IdParam,
  IdempotencyHeaderSchema,
  IsoDateTime,
  Uuid,
  problemResponse,
  toIso,
  toIsoRequired,
} from './schemas';

const TAG = 'Lists';

const ListSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string().nullable(),
    opt_in: z.enum(['single', 'double']),
    confirmation_mode: z.enum(['one_step', 'two_step']),
    confirmation_ttl_hours: z.number().int(),
    confirmation_max_resends: z.number().int(),
    send_welcome: z.boolean(),
    is_default: z.boolean(),
    archived_at: IsoDateTime.nullable(),
    created_at: IsoDateTime,
  })
  .openapi('List');

const CreateListSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    opt_in: z.enum(['single', 'double']).default('double'),
    /**
     * Výchozí je one_step podle rozhodnutí zadavatele. V obou režimech potvrzuje
     * až POST; one_step znamená, že stránka formulář odešle sama skriptem.
     */
    confirmation_mode: z.enum(['one_step', 'two_step']).default(DEFAULT_CONFIRMATION_MODE),
    confirmation_ttl_hours: z
      .number()
      .int()
      .min(1)
      .max(720)
      .default(DEFAULT_CONFIRMATION_TTL_HOURS),
    confirmation_max_resends: z.number().int().min(0).max(10).optional(),
    send_welcome: z.boolean().default(false),
    is_default: z.boolean().default(false),
  })
  .strict()
  .openapi('CreateList');

const PatchListSchema = CreateListSchema.partial().omit({ is_default: true }).strict();

const SubscribeSchema = z
  .object({
    email: EmailInput,
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    locale: z.string().max(35).optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    /** Vyžaduje scope contacts:write a navíc prohlášení o doloženém souhlasu. */
    skip_confirmation: z.boolean().default(false),
    declaration: z.boolean().default(false),
    consent_text: z.string().max(4000).optional(),
  })
  .strict()
  .openapi('Subscribe');

const SubscribeResultSchema = z.object({
  contact_id: Uuid.nullable(),
  status: z.enum(['pending', 'confirmed', 'unsubscribed', 'bounced', 'complained']).nullable(),
  outcome: z.string(),
});

const StatsSchema = z.object({
  pending: z.number().int(),
  confirmed: z.number().int(),
  unsubscribed: z.number().int(),
  bounced: z.number().int(),
  complained: z.number().int(),
  total: z.number().int(),
});

function present(row: ListRow): z.infer<typeof ListSchema> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    opt_in: row.optIn,
    confirmation_mode: row.confirmationMode,
    confirmation_ttl_hours: row.confirmationTtlHours,
    confirmation_max_resends: row.confirmationMaxResends,
    send_welcome: row.sendWelcome,
    is_default: row.isDefault,
    archived_at: toIso(row.deletedAt),
    created_at: toIsoRequired(row.createdAt),
  };
}

/**
 * Vnitřní výsledek přihlášení na HTTP status. Blokace ze stížnosti a ze suppression
 * jsou 409, protože volající je administrátor nebo integrace a musí se to dozvědět;
 * veřejný formulář naopak odpovídá vždy stejně (rozhodnutí R9) a tenhle překlad nepoužívá.
 */
const BLOCKED_OUTCOMES = new Set(['blocked_complaint', 'blocked_suppressed']);

const listRoute = createRoute({
  method: 'get',
  path: '/lists',
  tags: [TAG],
  summary: 'Seznamy projektu',
  security: [{ bearerAuth: ['lists:read'] }],
  request: { query: z.object({ include_archived: z.enum(['true', 'false']).optional() }) },
  responses: {
    200: {
      description: 'Seznamy projektu',
      content: { 'application/json': { schema: z.object({ data: z.array(ListSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const createListRoute = createRoute({
  method: 'post',
  path: '/lists',
  tags: [TAG],
  summary: 'Založení seznamu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateListSchema } } } },
  responses: {
    201: {
      description: 'Vytvořeno',
      content: { 'application/json': { schema: z.object({ data: ListSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/lists/{id}',
  tags: [TAG],
  summary: 'Detail seznamu',
  security: [{ bearerAuth: ['lists:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Detail seznamu',
      content: { 'application/json': { schema: z.object({ data: ListSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const patchListRoute = createRoute({
  method: 'patch',
  path: '/lists/{id}',
  tags: [TAG],
  summary: 'Úprava seznamu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchListSchema } } },
  },
  responses: {
    200: {
      description: 'Upraveno',
      content: { 'application/json': { schema: z.object({ data: ListSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const archiveListRoute = createRoute({
  method: 'delete',
  path: '/lists/{id}',
  tags: [TAG],
  summary: 'Archivace seznamu, přihlášení zůstávají',
  security: [{ bearerAuth: ['lists:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Archivováno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const defaultListRoute = createRoute({
  method: 'post',
  path: '/lists/{id}/default',
  tags: [TAG],
  summary: 'Nastavení výchozího seznamu projektu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Nastaveno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const subscribeRoute = createRoute({
  method: 'post',
  path: '/lists/{id}/subscribe',
  tags: [TAG],
  summary: 'Přihlášení do seznamu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SubscribeSchema } } },
  },
  responses: {
    200: {
      description: 'Přihlášeno',
      content: { 'application/json': { schema: SubscribeResultSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const unsubscribeRoute = createRoute({
  method: 'delete',
  path: '/lists/{id}/subscribe',
  tags: [TAG],
  summary: 'Odhlášení ze seznamu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': { schema: z.object({ email: EmailInput }).strict() },
      },
    },
  },
  responses: {
    204: { description: 'Odhlášeno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const bulkSubscribeRoute = createRoute({
  method: 'post',
  path: '/lists/{id}/subscribe:bulk',
  tags: [TAG],
  summary: 'Hromadné přihlášení, nejvýš tisíc adres',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    headers: IdempotencyHeaderSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({ subscribers: z.array(SubscribeSchema).min(1).max(1000) }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Výsledek po položkách',
      content: {
        'application/json': {
          schema: z.object({
            results: z.array(
              z.object({
                index: z.number().int(),
                outcome: z.string(),
                contact_id: Uuid.nullable(),
              }),
            ),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed', 'too_many_items'),
    429: problemResponse('rate_limited'),
  },
});

const resendRoute = createRoute({
  method: 'post',
  path: '/lists/{id}/resend-confirmation',
  tags: [TAG],
  summary: 'Opakované odeslání potvrzovacího e-mailu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: z.object({ contact_id: Uuid }).strict() } } },
  },
  responses: {
    200: {
      description: 'Odesláno nebo zamítnuto limitem',
      content: { 'application/json': { schema: z.object({ outcome: z.string() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const statsRoute = createRoute({
  method: 'get',
  path: '/lists/{id}/stats',
  tags: [TAG],
  summary: 'Počty přihlášení podle stavu',
  security: [{ bearerAuth: ['lists:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Počty', content: { 'application/json': { schema: StatsSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

/** Prohlášení o doloženém souhlasu se kontroluje na jednom místě pro obě cesty zápisu. */
function assertDeclaration(body: { skip_confirmation: boolean; declaration: boolean }): void {
  // Vynucené potvrzení jde obejít jen s výslovným prohlášením, že souhlas je doložený.
  // Bez něj by import mohl obejít celý smysl dvojího potvrzení.
  if (body.skip_confirmation && !body.declaration) {
    throw validationFailed([
      {
        path: 'declaration',
        code: 'required_field_missing',
        message: 'Přeskočení potvrzení vyžaduje prohlášení o doloženém souhlasu.',
      },
    ]);
  }
}

export function registerListRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:read');
    const includeArchived = c.req.valid('query').include_archived === 'true';
    const rows = await listAll(ctx, { includeArchived });
    return c.json({ data: rows.map(present) }, 200);
  });

  app.openapi(createListRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const body = c.req.valid('json');
    const row = await createList(ctx, {
      name: body.name,
      description: body.description ?? null,
      optIn: body.opt_in,
      confirmationMode: body.confirmation_mode,
      confirmationTtlHours: body.confirmation_ttl_hours,
      ...(body.confirmation_max_resends === undefined
        ? {}
        : { confirmationMaxResends: body.confirmation_max_resends }),
      sendWelcome: body.send_welcome,
      isDefault: body.is_default,
    });
    c.header('Location', `/api/v1/lists/${row.id}`);
    return c.json({ data: present(row) }, 201);
  });

  app.openapi(detailRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:read');
    const row = await listById(ctx, c.req.valid('param').id, { includeArchived: true });
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: present(row) }, 200);
  });

  app.openapi(patchListRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const body = c.req.valid('json');
    const row = await updateList(ctx, c.req.valid('param').id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.opt_in === undefined ? {} : { optIn: body.opt_in }),
      ...(body.confirmation_mode === undefined ? {} : { confirmationMode: body.confirmation_mode }),
      ...(body.confirmation_ttl_hours === undefined
        ? {}
        : { confirmationTtlHours: body.confirmation_ttl_hours }),
      ...(body.confirmation_max_resends === undefined
        ? {}
        : { confirmationMaxResends: body.confirmation_max_resends }),
      ...(body.send_welcome === undefined ? {} : { sendWelcome: body.send_welcome }),
    });
    return c.json({ data: present(row) }, 200);
  });

  app.openapi(archiveListRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    await archiveList(ctx, c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(defaultListRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    await setDefault(ctx, c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(subscribeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const body = c.req.valid('json');
    assertDeclaration(body);

    const result = await subscribeToList(ctx, {
      listId: c.req.valid('param').id,
      email: body.email,
      firstName: body.first_name ?? null,
      lastName: body.last_name ?? null,
      ...(body.attributes === undefined ? {} : { attributes: body.attributes }),
      locale: body.locale ?? null,
      source: 'api',
      skipConfirmation: body.skip_confirmation,
      declaration: body.declaration,
      consentText: body.consent_text ?? null,
    });

    // Administrátorská cesta se od veřejného formuláře liší schválně: blokovanou adresu
    // musí volající poznat, jinak by integrace tiše zahazovala přihlášení.
    if (BLOCKED_OUTCOMES.has(result.outcome)) {
      throw new ApiError('conflict', {
        params: {
          detail:
            result.outcome === 'blocked_complaint'
              ? 'subscribe_blocked_complaint'
              : 'subscribe_blocked_suppressed',
        },
      });
    }

    return c.json(
      {
        contact_id: result.contactId,
        status: result.subscriptionStatus,
        outcome: result.outcome,
      },
      200,
    );
  });

  app.openapi(unsubscribeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const contact = await findContactByEmail(ctx, c.req.valid('json').email);
    if (contact !== null) {
      // listId se předává vždy explicitně, i kdyby bylo null: vynechání by v části 4a
      // znamenalo jiný rozsah rušení čekajících zpráv (kritérium 79).
      await unsubscribe(ctx, {
        contactId: contact.id,
        listId: c.req.valid('param').id,
        reason: 'api',
      });
    }
    // Odpověď je stejná i pro neznámou adresu: jinak by z endpointu byl nástroj
    // na ověřování, kdo je v databázi.
    return c.body(null, 204);
  });

  app.openapi(bulkSubscribeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const listId = c.req.valid('param').id;
    const results: { index: number; outcome: string; contact_id: string | null }[] = [];

    for (const [index, item] of c.req.valid('json').subscribers.entries()) {
      assertDeclaration(item);
      const result = await subscribeToList(ctx, {
        listId,
        email: item.email,
        firstName: item.first_name ?? null,
        lastName: item.last_name ?? null,
        ...(item.attributes === undefined ? {} : { attributes: item.attributes }),
        locale: item.locale ?? null,
        source: 'api',
        skipConfirmation: item.skip_confirmation,
        declaration: item.declaration,
        consentText: item.consent_text ?? null,
      });
      results.push({ index, outcome: result.outcome, contact_id: result.contactId });
    }

    return c.json({ results }, 200);
  });

  app.openapi(resendRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const result = await resendConfirmation(ctx, {
      listId: c.req.valid('param').id,
      contactId: c.req.valid('json').contact_id,
    });
    // Limit tří odeslání za 24 hodin je doménové rozhodnutí, ne HTTP: vrací se 200
    // s outcome `resend_throttled`, aby klient poznal rozdíl mezi "odesláno"
    // a "zamítnuto limitem", a přitom se z toho nestala chyba integrace.
    return c.json({ outcome: result.outcome }, 200);
  });

  app.openapi(statsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:read');
    const id = c.req.valid('param').id;
    if ((await listById(ctx, id, { includeArchived: true })) === null) {
      throw new ApiError('not_found');
    }
    return c.json(await listStats(ctx, id), 200);
  });
}
