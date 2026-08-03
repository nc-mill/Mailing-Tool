import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { cancelSnooze } from '../lists/unsubscribe';
import { previewName, replaceContact } from '../repo/contact-edit';
import { getContactById } from '../repo/contacts-query';
import type { ContactsEnv } from './index';
import {
  ContactResponseSchema,
  ContactUpsertRequestSchema,
  IdParam,
  Uuid,
  problemResponse,
} from './schemas';

const TAG = 'Contacts';

/**
 * Tělo editačního formuláře. Proti `ContactUpsertRequestSchema` chybí tři věci a u každé
 * je to rozhodnutí, ne opomenutí:
 *
 *   email        adresa se zápisem nemění (pravidlo 1). Na změnu je POST /contacts/{id}/change-email,
 *                protože musí přepočítat otisky a ověřit kolizi s živým kontaktem.
 *   on_conflict  režim si volí trasa, ne klient. PUT znamená `overwrite`, viz repo/contact-edit.ts.
 *   consent      souhlas se zaznamenává, ne edituje. Přepsat historii souhlasu formulářem
 *                by zahodilo doklad, kterým se projekt hájí před dozorovým úřadem.
 */
const ContactEditRequestSchema = ContactUpsertRequestSchema.omit({
  email: true,
  on_conflict: true,
  consent: true,
}).openapi('ContactEditRequest');

/**
 * PUT, ne PATCH. Rozdíl je v tom, co znamená chybějící hodnota: u PATCH "nesahej na to",
 * u PUT "má být prázdné". Editační formulář posílá celý stav obrazovky, takže potřebuje
 * druhý význam. PATCH na téže cestě zůstává a nemění se, dávkové integrace na něm stojí.
 */
const editRoute = createRoute({
  method: 'put',
  path: '/contacts/{id}',
  tags: [TAG],
  summary: 'Úplná úprava kontaktu z formuláře, prázdné pole hodnotu maže',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ContactEditRequestSchema } } },
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

/**
 * Zrušení pozastavení odběru. Do téhle chvíle uměl produkt odběr jen pozastavit:
 * `snooze` volá stránka předvoleb, protějšek neexistoval nikde, takže tlačítko
 * „Zrušit pauzu" na detailu kontaktu nemělo co zavolat.
 *
 * `list_id` je nepovinné. Bez něj se ruší pauza ve všech seznamech, což je to, co
 * uživatel čeká od tlačítka na detailu kontaktu; s ním jen v jednom.
 */
const cancelSnoozeRoute = createRoute({
  method: 'post',
  path: '/contacts/{id}/cancel-snooze',
  tags: [TAG],
  summary: 'Zrušení pozastavení odběru',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          schema: z.object({ list_id: Uuid.nullable().optional() }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Pauza zrušena, `cleared` je počet dotčených přihlášení',
      content: {
        'application/json': { schema: z.object({ cleared: z.number().int() }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const NamePreviewResponseSchema = z
  .object({
    greeting: z.string(),
    greeting_neutral: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    first_name_vocative: z.string().nullable(),
    last_name_vocative: z.string().nullable(),
    vocative_confidence: z.enum(['high', 'low', 'none']),
    name_split_confidence: z.enum(['high', 'low', 'none']),
    gender: z.enum(['female', 'male', 'unknown']),
    gender_source: z.string(),
    warnings: z.array(z.string()),
  })
  .openapi('NamePreview');

/**
 * Náhled oslovení. Cesta je ZÁMĚRNĚ mimo `/contacts`: kdyby byla `/contacts/name-preview`,
 * musela by se registrovat dřív než `/contacts/{id}`, jinak by ji router poslal do
 * parametru a klient by dostal `invalid_uuid` místo náhledu. Vlastní kořen tuhle
 * závislost na pořadí registrace ruší úplně, stejně jako u `/name-overrides`.
 *
 * Je to POST, ne GET, ze stejného důvodu jako u `/contacts/lookup`: jméno je osobní údaj
 * a nemá co dělat v URL, v access logu ani v historii prohlížeče.
 */
const namePreviewRoute = createRoute({
  method: 'post',
  path: '/name-preview',
  tags: ['Name overrides'],
  summary: 'Jak bude kontakt osloven, kdyby se tenhle tvar jména uložil',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              first_name: z.string().max(100).nullable().optional(),
              last_name: z.string().max(100).nullable().optional(),
              full_name: z.string().max(200).nullable().optional(),
              title_prefix: z.string().max(50).nullable().optional(),
              title_suffix: z.string().max(50).nullable().optional(),
              gender: z.enum(['female', 'male', 'unknown']).optional(),
              locale: z.string().max(35).optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Náhled oslovení',
      content: { 'application/json': { schema: z.object({ data: NamePreviewResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

/**
 * Registrace se volá AŽ ZA `registerContactRoutes`. Stínění tím nevzniká: `PUT /contacts/{id}`
 * je jiná metoda než cokoliv registrovaného dřív, `/contacts/{id}/cancel-snooze` má o segment
 * navíc a `/name-preview` je vlastní kořen.
 */
export function registerContactEditRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(editRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const row = await replaceContact(ctx, c.req.valid('param').id, c.req.valid('json'));
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });

  app.openapi(cancelSnoozeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const { id } = c.req.valid('param');

    // Existence kontaktu se ověřuje zvlášť. `cancelSnooze` sama vrátí cleared: 0 jak
    // u neexistujícího kontaktu, tak u kontaktu bez pauzy, a to jsou dvě různé odpovědi:
    // 404 a 200.
    if ((await getContactById(ctx, id)) === null) throw new ApiError('not_found');

    const result = await cancelSnooze(ctx, {
      contactId: id,
      listId: c.req.valid('json').list_id ?? null,
    });
    return c.json({ cleared: result.cleared }, 200);
  });

  app.openapi(namePreviewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const body = c.req.valid('json');
    const name = await previewName(ctx, {
      firstName: body.first_name,
      lastName: body.last_name,
      fullName: body.full_name,
      titlePrefix: body.title_prefix,
      titleSuffix: body.title_suffix,
      ...(body.gender === undefined ? {} : { gender: body.gender }),
      ...(body.locale === undefined ? {} : { locale: body.locale }),
    });

    return c.json(
      {
        data: {
          greeting: name.greeting,
          greeting_neutral: name.greetingNeutral,
          first_name: name.firstName,
          last_name: name.lastName,
          first_name_vocative: name.firstNameVocative,
          last_name_vocative: name.lastNameVocative,
          vocative_confidence: name.vocativeConfidence,
          name_split_confidence: name.nameSplitConfidence,
          gender: name.gender,
          gender_source: name.genderSource,
          warnings: name.warnings,
        },
      },
      200,
    );
  });
}
