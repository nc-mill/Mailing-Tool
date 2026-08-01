import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import {
  archiveContactField,
  createContactField,
  deleteContactField,
  getContactField,
  getFieldImpact,
  getFieldLimits,
  listContactFields,
  requestFieldIndex,
  updateContactField,
  type ContactField,
} from '../repo/contact-fields';
import type { ContactsEnv } from './index';
import { IdParam, IsoDateTime, Uuid, problemResponse, toIso, toIsoRequired } from './schemas';

const TAG = 'Contact fields';

/**
 * LocalizedText podle 4.2.3 části 2: otevřená mapa jazyk na text s povinným klíčem 'en'.
 * Pevná dvojice { cs, en } tu vědomě není: přidání němčiny by jinak znamenalo migraci
 * schématu a zod .strict() by klíč 'de' odmítl už při ukládání.
 */
const LocalizedText = z
  .record(z.string().min(2).max(35), z.string().min(1).max(200))
  .refine((value) => typeof value['en'] === 'string' && value['en'].length > 0, {
    message: 'required_field_missing',
    path: ['en'],
  })
  .openapi('LocalizedText');

/**
 * ODCHYLKA OD PLÁNU: klíč smí mít nejvýš 40 znaků, ne 63, a výčet typů je ten z DDL.
 * Omezení `ck_contact_fields__key` je `^[a-z][a-z0-9_]{0,39}$` a `ck_contact_fields__type`
 * zná `long_text`, `enum` a `multi_enum`, ne `select` a `multiselect` z plánu. Delší klíč
 * nebo cizí typ by prošel validací a spadl by až na omezení databáze jako internal_error.
 */
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

const FieldTypeSchema = z.enum([
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'multi_enum',
  'url',
  'email',
  'phone',
]);

const IndexStateSchema = z.enum(['none', 'building', 'ready', 'failed']);

const ContactFieldSchema = z
  .object({
    id: Uuid,
    key: z.string(),
    label: z.record(z.string(), z.string()),
    description: z.record(z.string(), z.string()),
    type: FieldTypeSchema,
    options: z.record(z.string(), z.unknown()),
    required: z.boolean(),
    archived_at: IsoDateTime.nullable(),
    indexed: z.boolean(),
    index_state: IndexStateSchema,
    subject_editable: z.boolean(),
    position: z.number().int(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
  })
  .openapi('ContactField');

const CreateFieldBody = z
  .object({
    key: z.string().regex(FIELD_KEY, { message: 'invalid_format' }),
    label: LocalizedText,
    description: z.record(z.string(), z.string()).optional(),
    type: FieldTypeSchema,
    options: z.record(z.string(), z.unknown()).optional(),
    required: z.boolean().default(false),
    subject_editable: z.boolean().default(false),
  })
  .strict()
  .openapi('CreateContactField');

/**
 * Typ v těle PATCH záměrně chybí. Změna typu existujícího pole by musela přetypovat
 * hodnoty u všech kontaktů a u části z nich by selhala, takže je zakázaná
 * (field_type_immutable, 4.2.5). Díky .strict() dostane klient rovnou 422
 * s unknown_field_key a nemusí hádat.
 */
const PatchFieldBody = z
  .object({
    label: LocalizedText.optional(),
    description: z.record(z.string(), z.string()).optional(),
    required: z.boolean().optional(),
    subject_editable: z.boolean().optional(),
  })
  .strict()
  .openapi('PatchContactField');

const ListQuery = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

function present(field: ContactField): z.infer<typeof ContactFieldSchema> {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.type,
    options: field.options,
    required: field.required,
    archived_at: toIso(field.archivedAt),
    indexed: field.indexed,
    index_state: field.indexState,
    subject_editable: field.subjectEditable,
    position: field.position,
    created_at: toIsoRequired(field.createdAt),
    updated_at: toIsoRequired(field.updatedAt),
  };
}

const listRoute = createRoute({
  method: 'get',
  path: '/contact-fields',
  tags: [TAG],
  summary: 'Vlastní pole projektu i s využitím limitů',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { query: ListQuery },
  responses: {
    200: {
      description: 'Vlastní pole',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(ContactFieldSchema),
            limits: z.object({
              used: z.number().int(),
              limit: z.number().int(),
              indexed_used: z.number().int(),
              indexed_limit: z.number().int(),
            }),
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

const createFieldRoute = createRoute({
  method: 'post',
  path: '/contact-fields',
  tags: [TAG],
  summary: 'Založení vlastního pole',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateFieldBody } } } },
  responses: {
    201: {
      description: 'Pole vytvořeno',
      content: { 'application/json': { schema: z.object({ data: ContactFieldSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed', 'too_many_items'),
  },
});

const patchFieldRoute = createRoute({
  method: 'patch',
  path: '/contact-fields/{id}',
  tags: [TAG],
  summary: 'Úprava popisku a povinnosti, nikdy typu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchFieldBody } } },
  },
  responses: {
    200: {
      description: 'Pole upraveno',
      content: { 'application/json': { schema: z.object({ data: ContactFieldSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const impactRoute = createRoute({
  method: 'get',
  path: '/contact-fields/{id}/impact',
  tags: [TAG],
  summary: 'Dopad smazání pole před tím, než se smaže',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Dopad smazání',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const deleteFieldRoute = createRoute({
  method: 'delete',
  path: '/contact-fields/{id}',
  tags: [TAG],
  summary: 'Smazání pole i hodnot u kontaktů',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Pole smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const archiveFieldRoute = createRoute({
  method: 'post',
  path: '/contact-fields/{id}/archive',
  tags: [TAG],
  summary: 'Archivace pole, hodnoty zůstávají',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Pole archivováno',
      content: { 'application/json': { schema: z.object({ data: ContactFieldSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

const indexFieldRoute = createRoute({
  method: 'post',
  path: '/contact-fields/{id}/index',
  tags: [TAG],
  summary: 'Žádost o prověrku dotazovatelnosti pole',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    202: {
      description: 'Prověrka zařazena',
      content: { 'application/json': { schema: z.object({ index_state: IndexStateSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed', 'too_many_items'),
  },
});

export function registerContactFieldRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const { include_archived: includeArchived } = c.req.valid('query');
    const [fields, limits] = await Promise.all([
      listContactFields(ctx, { includeArchived }),
      getFieldLimits(ctx),
    ]);
    return c.json(
      {
        data: fields.map(present),
        limits: {
          used: limits.used,
          limit: limits.limit,
          indexed_used: limits.indexedUsed,
          indexed_limit: limits.indexedLimit,
        },
      },
      200,
    );
  });

  app.openapi(createFieldRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const body = c.req.valid('json');
    const { id } = await createContactField(ctx, {
      key: body.key,
      type: body.type,
      label: body.label as Record<string, string> & { en: string },
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.options === undefined ? {} : { options: body.options }),
      required: body.required,
      subjectEditable: body.subject_editable,
    });
    return c.json({ data: present(await getContactField(ctx, id)) }, 201);
  });

  app.openapi(patchFieldRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await updateContactField(ctx, id, {
      ...(body.label === undefined ? {} : { label: body.label as Record<string, string> }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.required === undefined ? {} : { required: body.required }),
      ...(body.subject_editable === undefined ? {} : { subjectEditable: body.subject_editable }),
    });
    return c.json({ data: present(await getContactField(ctx, id)) }, 200);
  });

  app.openapi(impactRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const impact = await getFieldImpact(ctx, c.req.valid('param').id);
    return c.json(impact as unknown as Record<string, unknown>, 200);
  });

  app.openapi(deleteFieldRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    await deleteContactField(ctx, c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(archiveFieldRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    await archiveContactField(ctx, id);
    return c.json({ data: present(await getContactField(ctx, id)) }, 200);
  });

  app.openapi(indexFieldRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');
    // 202, protože prověrka nad pěti miliony řádků trvá desítky sekund a běží
    // ve frontě contact_fields.verify_index. Stav se pak čte z index_state.
    await requestFieldIndex(ctx, id);
    const field = await getContactField(ctx, id);
    if (field === null) throw new ApiError('not_found');
    return c.json({ index_state: field.indexState }, 202);
  });
}
