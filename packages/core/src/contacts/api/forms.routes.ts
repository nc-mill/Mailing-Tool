import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { loadConfig } from '../../config/index';
import { ApiError, validationFailed } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { buildEmbedSnippets } from '../forms/embed';
import { validateFormFields, type FormField } from '../forms/definition';
import { findTemplateById } from '../../templates/repository';
import { withWorkspace } from '../../tx';
import { listContactFields } from '../repo/contact-fields';
import { byId as listById } from '../repo/lists';
import {
  acceptedCounts30d,
  createForm,
  deleteForm,
  findFormById,
  formSubmissionStats,
  listForms,
  listSubmissions,
  publicFormRef,
  updateForm,
  type FormRow,
} from '../repo/forms';
import type { ContactsEnv } from './index';
import { IdParam, IsoDateTime, Uuid, problemResponse } from './schemas';

const TAG = 'Forms';

/**
 * Oprávnění jsou `contacts:read` a `contacts:write`, ne vlastní dvojice.
 *
 * Formulář je zapisovač do kontaktů: co skrz něj přijde, skončí v `contacts`
 * a v přihlášení do seznamu. Vlastní oprávnění by znamenalo, že se dá obejít
 * omezení, kdo smí zapisovat kontakty, tím, že si dotyčný založí formulář.
 */
const READ = 'contacts:read';
const WRITE = 'contacts:write';

/**
 * Pole formuláře v těle požadavku.
 *
 * ODCHYLKA OD `FormFieldSchema`, VYNUCENÁ TVAREM API. Doménové schéma žádá popisky
 * jako mapu jazyků s povinným `en`. Rozhraní zakládá formulář v jazyce projektu
 * a psát do těla `{ "cs": "E-mail", "en": "E-mail" }` by z jednoduchého formuláře
 * udělalo překladatelský nástroj. Tělo proto přijímá i prostý řetězec a ten se
 * na mapu `{ en: ... }` převede tady, na jednom místě.
 */
const LocalizedInput = z.union([
  z.string().min(1).max(200),
  z.object({ en: z.string().min(1).max(200) }).catchall(z.string().max(200)),
]);

function toLocalized(
  value: z.infer<typeof LocalizedInput>,
): { en: string } & Record<string, string> {
  return typeof value === 'string' ? { en: value } : value;
}

const FormFieldInput = z
  .object({
    target: z.union([
      z.enum(['email', 'first_name', 'last_name', 'full_name', 'locale']),
      z.object({ attribute: z.string().min(1).max(80) }).strict(),
    ]),
    label: LocalizedInput,
    placeholder: LocalizedInput.optional(),
    required: z.boolean().default(false),
    type: z.enum([
      'text',
      'textarea',
      'email',
      'url',
      'tel',
      'select',
      'checkbox',
      'date',
      'datetime',
      'number',
      'hidden',
    ]),
    /**
     * Nabízené hodnoty u `select`. Když pole míří na vlastní pole kontaktu, které
     * svoje hodnoty už má, PŘEBÍRAJÍ SE Z NĚJ a tělo je uvádět nemusí: dvě sady
     * hodnot by se časem rozešly a zápis by neprošel `coerceValue`.
     */
    options: z
      .array(z.object({ value: z.string().min(1).max(200), label: LocalizedInput }).strict())
      .max(50)
      .optional(),
    default_value: z.string().max(1000).optional(),
  })
  .strict();

const FormFieldOutput = z.object({
  target: z.union([z.string(), z.object({ attribute: z.string() })]),
  label: z.record(z.string(), z.string()),
  required: z.boolean(),
  type: z.string(),
  options: z
    .array(z.object({ value: z.string(), label: z.record(z.string(), z.string()) }))
    .optional(),
});

const FormSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    /**
     * VEŘEJNÝ identifikátor z `publicFormRef`, ne holý `forms.slug`. Veřejné adresy
     * nesou projekt v sobě (`public/ids.ts`), takže odkaz z holého slugu by na `/f/**`
     * skončil stránkou „odkaz neplatí" a nikdo by nepoznal proč.
     */
    slug: z.string(),
    hosted_url: z.string(),
    fields: z.array(FormFieldOutput),
    list_ids: z.array(Uuid),
    tag_ids: z.array(Uuid),
    double_opt_in: z.boolean(),
    consent_text: z.string().nullable(),
    consent_required: z.boolean(),
    legal_basis: z.enum(['consent', 'legitimate_interest', 'contract', 'soft_opt_in']),
    honeypot_field: z.string(),
    min_fill_seconds: z.number().int(),
    allowed_origins: z.array(z.string()),
    captcha_provider: z.enum(['none', 'turnstile', 'hcaptcha']),
    redirect_url: z.string().nullable(),
    /** Šablona e-mailu, který přijde po vyplnění. `null` = formulář nic neposílá. */
    delivery_template_id: Uuid.nullable(),
    success_message: z.record(z.string(), z.string()),
    active: z.boolean(),
    submission_count: z.number().int(),
    /** Přijatá odeslání za 30 dní. V detailu je vždy, v seznamu se dopočítává hromadně. */
    accepted_30d: z.number().int(),
    created_at: IsoDateTime,
    updated_at: IsoDateTime,
  })
  .openapi('Form');

/**
 * Tělo založení. Povinné je jedině jméno.
 *
 * Výchozí hodnoty NEJSOU v tomhle schématu: vlastní je `FormDefinitionSchema` v doméně
 * a druhá sada výchozích hodnot v API by se s ní časem rozešla. Platí tedy doménové
 * výchozí chování, tedy zapnuté dvojí potvrzení, vypnutá captcha třetí strany
 * a jediné pole `email`, které dopisuje `withDefaultFields` níž.
 */
const CreateFormSchema = z
  .object({
    name: z.string().min(1).max(200),
    fields: z.array(FormFieldInput).max(15).optional(),
    list_ids: z.array(Uuid).max(20).optional(),
    tag_ids: z.array(Uuid).max(20).optional(),
    double_opt_in: z.boolean().optional(),
    consent_text: z.string().max(2000).nullable().optional(),
    consent_required: z.boolean().optional(),
    legal_basis: z.enum(['consent', 'legitimate_interest', 'contract', 'soft_opt_in']).optional(),
    honeypot_field: z.string().min(1).max(50).optional(),
    min_fill_seconds: z.number().int().min(0).max(60).optional(),
    allowed_origins: z.array(z.url()).max(20).optional(),
    captcha_provider: z.enum(['none', 'turnstile', 'hcaptcha']).optional(),
    redirect_url: z.url().nullable().optional(),
    delivery_template_id: Uuid.nullable().optional(),
    success_message: z.record(z.string(), z.string().max(200)).optional(),
    active: z.boolean().optional(),
    custom_css: z.string().max(20000).nullable().optional(),
  })
  .strict()
  .openapi('CreateForm');

const PatchFormSchema = CreateFormSchema.partial().strict();

const EmbedSchema = z
  .object({
    slug: z.string(),
    hosted_url: z.string(),
    script: z.string(),
    iframe: z.string(),
    /** Kdy dorazilo první přijaté odeslání. `null` znamená „zatím nic". */
    first_submission_at: IsoDateTime.nullable(),
  })
  .openapi('FormEmbed');

const SubmissionSchema = z.object({
  id: Uuid,
  status: z.enum(['accepted', 'rejected', 'dropped']),
  error_code: z.string().nullable(),
  contact_id: Uuid.nullable(),
  page_url: z.string().nullable(),
  created_at: IsoDateTime,
});

function hostedUrl(ref: string): string {
  return `${loadConfig().APP_URL.replace(/\/$/, '')}/f/${ref}`;
}

function present(row: FormRow, accepted30d: number): z.infer<typeof FormSchema> {
  const ref = publicFormRef(row);
  return {
    id: row.id,
    name: row.name,
    slug: ref,
    hosted_url: hostedUrl(ref),
    fields: row.fields,
    list_ids: row.listIds,
    tag_ids: row.tagIds,
    double_opt_in: row.doubleOptIn,
    consent_text: row.consentText,
    consent_required: row.consentRequired,
    legal_basis: row.legalBasis,
    honeypot_field: row.honeypotField,
    min_fill_seconds: row.minFillSeconds,
    allowed_origins: row.allowedOrigins,
    captcha_provider: row.captchaProvider,
    redirect_url: row.redirectUrl,
    delivery_template_id: row.deliveryTemplateId,
    success_message: row.successMessage,
    active: row.active,
    submission_count: row.submissionCount,
    accepted_30d: accepted30d,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/**
 * Formulář bez jediného pole by byl past: vznikl by, dal by se vložit na web
 * a neposbíral by nic, protože adresu není kam napsat. Zakládání proto dopisuje
 * pole `email`, když ho tělo neuvádí.
 */
function withDefaultFields(fields: FormField[] | undefined): FormField[] {
  if (fields !== undefined && fields.length > 0) return fields;
  return [
    {
      target: 'email',
      label: { en: 'Email', cs: 'E-mail' },
      required: true,
      type: 'email',
    },
  ];
}

function toDomainFields(input: z.infer<typeof FormFieldInput>[] | undefined): FormField[] {
  if (input === undefined) return [];
  return input.map((field) => ({
    target: field.target,
    label: toLocalized(field.label),
    ...(field.placeholder === undefined ? {} : { placeholder: toLocalized(field.placeholder) }),
    required: field.required,
    type: field.type,
    ...(field.options === undefined
      ? {}
      : { options: field.options.map((o) => ({ value: o.value, label: toLocalized(o.label) })) }),
    ...(field.default_value === undefined ? {} : { defaultValue: field.default_value }),
  }));
}

/**
 * Kontrola, že pole formuláře míří na existující vlastní pole a seznamy na existující
 * seznamy. Obojí se ověřuje při UKLÁDÁNÍ, ne až při odeslání: jinak by se uživatel
 * o překlepu dozvěděl tím, že mu chybí data, a nikdo by nehledal příčinu ve formuláři.
 */
async function assertReferences(
  ctx: WorkspaceContext,
  input: { fields?: FormField[]; listIds?: string[]; deliveryTemplateId?: string | null },
): Promise<void> {
  if (input.fields !== undefined && input.fields.length > 0) {
    const catalog = await listContactFields(ctx);
    const check = validateFormFields(
      input.fields,
      catalog.map((field) => field.key),
    );
    if (!check.ok) {
      throw validationFailed([
        {
          path: check.path,
          code: check.code,
          message: 'Formulář odkazuje na vlastní pole, které v projektu neexistuje.',
        },
      ]);
    }
  }

  if (input.deliveryTemplateId !== undefined && input.deliveryTemplateId !== null) {
    const templateId = input.deliveryTemplateId;
    const found = await withWorkspace(ctx, async (tx) => findTemplateById(tx, ctx, templateId));
    if (found === undefined) {
      throw validationFailed([
        {
          path: 'delivery_template_id',
          code: 'unknown_reference',
          message: 'E-mail, který má formulář poslat, v projektu neexistuje.',
        },
      ]);
    }
  }

  for (const [index, listId] of (input.listIds ?? []).entries()) {
    if ((await listById(ctx, listId, { includeArchived: true })) === null) {
      throw validationFailed([
        {
          path: `list_ids.${index}`,
          code: 'unknown_reference',
          message: 'Seznam, do kterého má formulář zapisovat, neexistuje.',
        },
      ]);
    }
  }
}

const listRoute = createRoute({
  method: 'get',
  path: '/forms',
  tags: [TAG],
  summary: 'Formuláře projektu',
  security: [{ bearerAuth: [READ] }],
  request: { query: z.object({ include_inactive: z.enum(['true', 'false']).optional() }) },
  responses: {
    200: {
      description: 'Formuláře projektu',
      content: { 'application/json': { schema: z.object({ data: z.array(FormSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const createFormRoute = createRoute({
  method: 'post',
  path: '/forms',
  tags: [TAG],
  summary: 'Založení formuláře',
  security: [{ bearerAuth: [WRITE] }],
  request: { body: { content: { 'application/json': { schema: CreateFormSchema } } } },
  responses: {
    201: {
      description: 'Vytvořeno',
      content: { 'application/json': { schema: z.object({ data: FormSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const detailRoute = createRoute({
  method: 'get',
  path: '/forms/{id}',
  tags: [TAG],
  summary: 'Detail formuláře',
  security: [{ bearerAuth: [READ] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Detail formuláře',
      content: { 'application/json': { schema: z.object({ data: FormSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const patchFormRoute = createRoute({
  method: 'patch',
  path: '/forms/{id}',
  tags: [TAG],
  summary: 'Úprava formuláře, včetně pozastavení',
  security: [{ bearerAuth: [WRITE] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchFormSchema } } },
  },
  responses: {
    200: {
      description: 'Upraveno',
      content: { 'application/json': { schema: z.object({ data: FormSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

/**
 * Smazání formuláře. Nevratné a bere s sebou i historii odeslání (kaskáda v databázi).
 *
 * Protějšek archivace seznamu je tady POZASTAVENÍ přes `PATCH { active: false }`:
 * tabulka `forms` sloupec `deleted_at` nemá, takže „archivovaný formulář" by nebylo
 * kam uložit. Rozhraní nabízí obě cesty a mazání staví jako to nevratné.
 */
const deleteFormRoute = createRoute({
  method: 'delete',
  path: '/forms/{id}',
  tags: [TAG],
  summary: 'Smazání formuláře i s historií odeslání',
  security: [{ bearerAuth: [WRITE] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const embedRoute = createRoute({
  method: 'get',
  path: '/forms/{id}/embed',
  tags: [TAG],
  summary: 'Vkládací kód ve třech variantách',
  security: [{ bearerAuth: [READ] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Kód k vložení a adresa hotové stránky',
      content: { 'application/json': { schema: EmbedSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const submissionsRoute = createRoute({
  method: 'get',
  path: '/forms/{id}/submissions',
  tags: [TAG],
  summary: 'Poslední odeslání formuláře',
  security: [{ bearerAuth: [READ] }],
  request: {
    params: IdParam,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['accepted', 'rejected', 'dropped']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Odeslání, nejnovější první',
      content: { 'application/json': { schema: z.object({ data: z.array(SubmissionSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerFormRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, READ);
    const rows = await listForms(ctx, {
      includeInactive: c.req.valid('query').include_inactive !== 'false',
    });
    const counts = await acceptedCounts30d(ctx);
    return c.json({ data: rows.map((row) => present(row, counts.get(row.id) ?? 0)) }, 200);
  });

  app.openapi(createFormRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, WRITE);
    const body = c.req.valid('json');
    const fields = withDefaultFields(toDomainFields(body.fields));
    await assertReferences(ctx, {
      fields,
      ...(body.list_ids === undefined ? {} : { listIds: body.list_ids }),
      ...(body.delivery_template_id === undefined
        ? {}
        : { deliveryTemplateId: body.delivery_template_id }),
    });

    const row = await createForm(ctx, {
      name: body.name,
      fields,
      ...(body.list_ids === undefined ? {} : { list_ids: body.list_ids }),
      ...(body.tag_ids === undefined ? {} : { tag_ids: body.tag_ids }),
      ...(body.double_opt_in === undefined ? {} : { double_opt_in: body.double_opt_in }),
      ...(body.consent_text === undefined ? {} : { consent_text: body.consent_text }),
      ...(body.consent_required === undefined ? {} : { consent_required: body.consent_required }),
      ...(body.legal_basis === undefined ? {} : { legal_basis: body.legal_basis }),
      ...(body.honeypot_field === undefined ? {} : { honeypot_field: body.honeypot_field }),
      ...(body.min_fill_seconds === undefined ? {} : { min_fill_seconds: body.min_fill_seconds }),
      ...(body.allowed_origins === undefined ? {} : { allowed_origins: body.allowed_origins }),
      ...(body.captcha_provider === undefined ? {} : { captcha_provider: body.captcha_provider }),
      ...(body.redirect_url === undefined ? {} : { redirect_url: body.redirect_url }),
      ...(body.delivery_template_id === undefined
        ? {}
        : { delivery_template_id: body.delivery_template_id }),
      ...(body.success_message === undefined ? {} : { success_message: body.success_message }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.custom_css === undefined ? {} : { custom_css: body.custom_css }),
    });

    c.header('Location', `/api/v1/forms/${row.id}`);
    return c.json({ data: present(row, 0) }, 201);
  });

  app.openapi(detailRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, READ);
    const row = await findFormById(ctx, c.req.valid('param').id);
    if (row === null) throw new ApiError('not_found');
    const stats = await formSubmissionStats(ctx, row.id);
    return c.json({ data: present(row, stats.accepted30d) }, 200);
  });

  app.openapi(patchFormRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, WRITE);
    const body = c.req.valid('json');
    const fields = body.fields === undefined ? undefined : toDomainFields(body.fields);
    await assertReferences(ctx, {
      ...(fields === undefined ? {} : { fields }),
      ...(body.list_ids === undefined ? {} : { listIds: body.list_ids }),
      ...(body.delivery_template_id === undefined
        ? {}
        : { deliveryTemplateId: body.delivery_template_id }),
    });

    const row = await updateForm(ctx, c.req.valid('param').id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(fields === undefined ? {} : { fields }),
      ...(body.list_ids === undefined ? {} : { list_ids: body.list_ids }),
      ...(body.tag_ids === undefined ? {} : { tag_ids: body.tag_ids }),
      ...(body.double_opt_in === undefined ? {} : { double_opt_in: body.double_opt_in }),
      ...(body.consent_text === undefined ? {} : { consent_text: body.consent_text }),
      ...(body.consent_required === undefined ? {} : { consent_required: body.consent_required }),
      ...(body.legal_basis === undefined ? {} : { legal_basis: body.legal_basis }),
      ...(body.honeypot_field === undefined ? {} : { honeypot_field: body.honeypot_field }),
      ...(body.min_fill_seconds === undefined ? {} : { min_fill_seconds: body.min_fill_seconds }),
      ...(body.allowed_origins === undefined ? {} : { allowed_origins: body.allowed_origins }),
      ...(body.captcha_provider === undefined ? {} : { captcha_provider: body.captcha_provider }),
      ...(body.redirect_url === undefined ? {} : { redirect_url: body.redirect_url }),
      ...(body.delivery_template_id === undefined
        ? {}
        : { delivery_template_id: body.delivery_template_id }),
      ...(body.success_message === undefined ? {} : { success_message: body.success_message }),
      ...(body.active === undefined ? {} : { active: body.active }),
      ...(body.custom_css === undefined ? {} : { custom_css: body.custom_css }),
    });

    const stats = await formSubmissionStats(ctx, row.id);
    return c.json({ data: present(row, stats.accepted30d) }, 200);
  });

  app.openapi(deleteFormRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, WRITE);
    await deleteForm(ctx, c.req.valid('param').id);
    return c.body(null, 204);
  });

  app.openapi(embedRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, READ);
    const row = await findFormById(ctx, c.req.valid('param').id);
    if (row === null) throw new ApiError('not_found');

    const ref = publicFormRef(row);
    const snippets = buildEmbedSnippets({ appUrl: loadConfig().APP_URL, slug: ref });
    const stats = await formSubmissionStats(ctx, row.id);

    return c.json(
      {
        slug: ref,
        hosted_url: hostedUrl(ref),
        script: snippets.script,
        iframe: snippets.iframe,
        first_submission_at: stats.firstAcceptedAt,
      },
      200,
    );
  });

  app.openapi(submissionsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, READ);
    const id = c.req.valid('param').id;
    // Neexistující formulář se musí ozvat 404. Bez téhle kontroly by překlep
    // v identifikátoru vrátil prázdný seznam a vypadal jako „zatím nic nedorazilo".
    if ((await findFormById(ctx, id)) === null) throw new ApiError('not_found');

    const query = c.req.valid('query');
    const rows = await listSubmissions(ctx, id, {
      limit: query.limit,
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    return c.json(
      {
        data: rows.map((row) => ({
          id: row.id,
          status: row.status,
          error_code: row.errorCode,
          contact_id: row.contactId,
          page_url: row.pageUrl,
          created_at: row.createdAt,
        })),
      },
      200,
    );
  });
}
