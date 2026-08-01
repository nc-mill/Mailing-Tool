import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { deleteContact, restoreContact, changeContactEmail } from '../repo/contacts';
import { batchUpsertFromApi, patchContact, upsertContactFromApi } from '../repo/contacts-api';
import {
  countContacts,
  findContactByEmail,
  getContactById,
  listContacts,
} from '../repo/contacts-query';
import { createGdprRequest } from '../repo/gdpr';
import type { ContactsEnv } from './index';
import {
  ContactResponseSchema,
  ContactUpsertRequestSchema,
  CountResponseSchema,
  EmailInput,
  IdParam,
  IdempotencyHeaderSchema,
  IsoDateTime,
  Uuid,
  cursorQuery,
  paginated,
  problemResponse,
  toIsoRequired,
} from './schemas';

const TAG = 'Contacts';

/**
 * Povolené řazení. Každá hodnota musí mít krycí index (konvence 4.3 části 1).
 * Řazení podle email ani last_name tu vědomě není: potřebovalo by další dva indexy nad
 * tabulkou s pěti miliony řádků a UI si tuhle stránku seřadí samo (5.1 části 2).
 */
const CONTACT_ORDERS = [
  'created_at.desc',
  'created_at.asc',
  'updated_at.desc',
  'last_activity_at.desc',
] as const;

const ListQuery = cursorQuery(CONTACT_ORDERS, 'created_at.desc').extend({
  q: z.string().max(200).optional(),
  status: z
    .enum(['active', 'unconfirmed', 'unsubscribed', 'bounced', 'complained', 'deleted'])
    .optional(),
  list_id: Uuid.optional(),
  tag_id: Uuid.optional(),
  segment_id: Uuid.optional(),
  created_after: IsoDateTime.optional(),
  created_before: IsoDateTime.optional(),
  vocative_confidence: z.enum(['high', 'low', 'none']).optional(),
});

/** Filtry počtu jsou tytéž jako u seznamu, jen bez stránkování. Jinak by počet neodpovídal seznamu. */
const CountQuery = ListQuery.omit({ limit: true, cursor: true, order: true });

const ContactPageSchema = paginated(ContactResponseSchema, 'ContactPage');

const DeleteQuery = z.object({
  /**
   * soft   = deleted_at, kontakt jde 30 dní obnovit,
   * anonymize = výmaz podle čl. 17 se zachováním statistik (4.14.4),
   * purge  = fyzické smazání řádku.
   */
  mode: z.enum(['soft', 'anonymize', 'purge']).default('soft'),
});

const BatchResultSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(['created', 'updated', 'skipped', 'error']),
      id: Uuid.optional(),
      error: z.object({ code: z.string() }).optional(),
    }),
  ),
});

const listRoute = createRoute({
  method: 'get',
  path: '/contacts',
  tags: [TAG],
  summary: 'Stránka kontaktů, nikdy s celkovým počtem',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: ListQuery },
  responses: {
    200: {
      description: 'Stránka kontaktů',
      content: { 'application/json': { schema: ContactPageSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const countRoute = createRoute({
  method: 'get',
  path: '/contacts/count',
  tags: [TAG],
  summary: 'Počet kontaktů pro tytéž filtry jako seznam',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: CountQuery },
  responses: {
    200: {
      description: 'Počet kontaktů',
      content: { 'application/json': { schema: CountResponseSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const lookupRoute = createRoute({
  method: 'post',
  path: '/contacts/lookup',
  tags: [TAG],
  summary: 'Vyhledání podle adresy, adresa nikdy není v URL',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: {
    body: { content: { 'application/json': { schema: z.object({ email: EmailInput }).strict() } } },
  },
  responses: {
    200: {
      description: 'Nalezený kontakt nebo null',
      content: {
        'application/json': { schema: z.object({ data: ContactResponseSchema.nullable() }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const batchRoute = createRoute({
  method: 'post',
  path: '/contacts/batch',
  tags: [TAG],
  summary: 'Dávkový zápis s výsledkem po položkách',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({ items: z.array(ContactUpsertRequestSchema).min(1).max(1000) })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Výsledek po položkách',
      content: { 'application/json': { schema: BatchResultSchema } },
    },
    400: problemResponse('validation_failed'),
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('idempotency_key_reuse', 'idempotency_request_in_progress'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const createContactRoute = createRoute({
  method: 'post',
  path: '/contacts',
  tags: [TAG],
  summary: 'Vytvoření nebo aktualizace kontaktu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: ContactUpsertRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Kontakt aktualizován',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    201: {
      description: 'Kontakt vytvořen',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'already_exists'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/contacts/{id}',
  tags: [TAG],
  summary: 'Detail kontaktu',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Detail kontaktu',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/contacts/{id}',
  tags: [TAG],
  summary: 'Částečná úprava kontaktu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          schema: ContactUpsertRequestSchema.partial().omit({ on_conflict: true, email: true }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Kontakt upraven',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/contacts/{id}',
  tags: [TAG],
  summary: 'Měkké smazání, anonymizace nebo fyzické smazání',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam, query: DeleteQuery },
  responses: {
    204: { description: 'Kontakt měkce smazán' },
    202: {
      description: 'Výmaz zařazen ke zpracování',
      content: { 'application/json': { schema: z.object({ request_id: Uuid }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const restoreRoute = createRoute({
  method: 'post',
  path: '/contacts/{id}/restore',
  tags: [TAG],
  summary: 'Obnovení měkce smazaného kontaktu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam, headers: IdempotencyHeaderSchema },
  responses: {
    200: {
      description: 'Kontakt obnoven',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const changeEmailRoute = createRoute({
  method: 'post',
  path: '/contacts/{id}/change-email',
  tags: [TAG],
  summary: 'Změna adresy s přepočtem otisků',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({ email: EmailInput }).strict() } } },
  },
  responses: {
    200: {
      description: 'Adresa změněna',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

/**
 * Pořadí registrace není kosmetika. Cesty se statickým posledním segmentem (count, lookup,
 * batch) musí být zaregistrované dřív než /contacts/{id}, jinak by je router poslal do
 * parametru a klient by dostal invalid_uuid místo odpovědi.
 */
export function registerContactRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(countRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const result = await countContacts(ctx, c.req.valid('query'));
    return c.json(
      {
        count: result.count,
        precision: result.precision,
        computed_at: toIsoRequired(result.computedAt),
        stale: result.stale,
      },
      200,
    );
  });

  app.openapi(lookupRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    // Vyhledání je POST právě proto, aby se adresa neobjevila v URL, v access logu ani
    // v historii prohlížeče (7.3 části 2). Nikdy z něj nedělej GET s query parametrem.
    const row = await findContactByEmail(ctx, c.req.valid('json').email);
    // Neznámá adresa není 404: 404 by se nedalo odlišit od chybné cesty a klient by musel hádat.
    return c.json({ data: row }, 200);
  });

  app.openapi(batchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const result = await batchUpsertFromApi(ctx, c.req.valid('json').items);
    return c.json({ results: result.results }, 200);
  });

  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const query = c.req.valid('query');
    const page = await listContacts(ctx, query);
    return c.json(
      {
        data: page.rows,
        pagination: {
          next_cursor: page.nextCursor,
          prev_cursor: page.prevCursor,
          has_more: page.hasMore,
          limit: query.limit,
        },
      },
      200,
    );
  });

  app.openapi(createContactRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { contact, created } = await upsertContactFromApi(ctx, c.req.valid('json'));
    if (created) c.header('Location', `/api/v1/contacts/${contact.id}`);
    return c.json({ data: contact }, created ? 201 : 200);
  });

  app.openapi(detailRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const row = await getContactById(ctx, c.req.valid('param').id);
    // Cizí projekt vrací 404, ne 403: 403 by potvrdilo, že to ID existuje (7.3 části 2).
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const row = await patchContact(ctx, c.req.valid('param').id, c.req.valid('json'));
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { ctx } = c.get('auth');
    const { id } = c.req.valid('param');
    const { mode } = c.req.valid('query');
    assertPermission(ctx, 'contacts:write');

    if (mode === 'soft') {
      await deleteContact(ctx, id, 'soft');
      return c.body(null, 204);
    }

    // Výmaz podle čl. 17 je jiná pravomoc než smazání řádku: maže i historii souhlasů
    // a je nevratný. Proto vedle contacts:write žádá i gdpr:erase, u purge navíc contacts:delete.
    assertPermission(ctx, 'gdpr:erase');
    if (mode === 'purge') assertPermission(ctx, 'contacts:delete');

    // ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal `enqueueErasure(ctx, {...})`,
    // funkci, která v doméně není. Výmaz podle čl. 17 zakládá ŽÁDOST v gdpr_requests
    // (`createGdprRequest`), protože jen ta nese lhůtu, ověření totožnosti a doklad
    // o provedení. Přímé zařazení jobu by výmaz provedlo bez jediného z toho.
    const contact = await getContactById(ctx, id);
    if (contact === null) throw new ApiError('not_found');

    // Vrací se 202, ne 204, přestože konvence u DELETE předepisuje 204. Anonymizace běží
    // ve frontě gdpr.erase a trvá desítky sekund; 204 by tvrdilo, že je hotovo, a to by
    // byla lež.
    const request = await createGdprRequest(ctx, {
      email: contact.email,
      type: 'erasure',
      mode,
      channel: 'api',
    });
    return c.json({ request_id: request.id }, 202);
  });

  app.openapi(restoreRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    await restoreContact(ctx, id);
    const row = await getContactById(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });

  app.openapi(changeEmailRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    await changeContactEmail(ctx, id, c.req.valid('json').email);
    const row = await getContactById(ctx, id);
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });
}
