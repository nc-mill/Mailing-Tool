import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Document } from '@mlain/emails/document/types';
import { ApiError, validationFailed } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { findTemplateById } from '../../templates/repository';
import { withWorkspace } from '../../tx';
import { DEFAULT_CONFIRMATION_MODE, DEFAULT_CONFIRMATION_TTL_HOURS } from '../constants';
import { getFieldCatalog } from '../fields/catalog';
import { confirmPendingSubscriptions } from '../lists/confirm-pending';
import { documentHasConfirmLink, documentUsesUnsubscribeUrl } from '../lists/confirm-link-guard';
import { resendConfirmation, subscribeToList } from '../lists/subscribe-service';
import { bulkUnsubscribeFromList, unsubscribe } from '../lists/unsubscribe';
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
import { assertPageTemplateRefs } from './page-refs';
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

/**
 * Strop obou hromadných operací nad seznamem. Přihlášení i odhlášení ho mají SPOLEČNÝ
 * schválně: jsou to dvě poloviny téže věci a různý strop by znamenal, že co se dá jedním
 * voláním přidat, se nedá jedním voláním odebrat.
 */
const BULK_LIMIT = 1000;

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
    send_goodbye: z.boolean(),
    /**
     * Šablony tří e-mailů seznamu. `null` znamená „použije se obecné znění",
     * ne chybějící hodnotu: obecné znění je konstanta typu `Document`
     * v `contacts/lists/default-emails.ts` a je to plnohodnotný e-mail.
     */
    confirmation_template_id: Uuid.nullable(),
    welcome_template_id: Uuid.nullable(),
    goodbye_template_id: Uuid.nullable(),
    confirm_redirect_url: z.string().nullable(),
    unsubscribe_redirect_url: z.string().nullable(),
    unsubscribe_scope: z.enum(['list', 'global']),
    already_subscribed_redirect_url: z.string().nullable(),
    /**
     * Veřejné stránky seznamu: návrhy druhu `page` místo vestavěné věty.
     * `null` znamená VESTAVĚNÝ TEXT, tedy dnešní chování.
     *
     * Je to jiná odpověď na tutéž otázku jako `*_redirect_url` o řádek výš:
     * co uvidí návštěvník po tomhle kroku. U potvrzení a u „už jste přihlášeni"
     * má přednost formulář, ze kterého přihlášení přišlo; stránka po odhlášení
     * je jen tady, protože se na ni chodí z odkazu v e-mailu.
     */
    confirmed_template_id: Uuid.nullable(),
    already_subscribed_template_id: Uuid.nullable(),
    unsubscribed_template_id: Uuid.nullable(),
    is_default: z.boolean(),
    public_visible: z.boolean(),
    public_name: z.string().nullable(),
    public_description: z.string().nullable(),
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
    /**
     * Rozloučení po odhlášení. Výchozí NE, rozhodnutí zadavatele z 5. 8. 2026:
     * část odesílatelů ho záměrně neposílá, protože e-mail po odhlášení bývá
     * vnímaný jako drzost.
     */
    send_goodbye: z.boolean().default(false),
    /** `null` vrací seznam k obecnému znění, viz `default-emails.ts`. */
    confirmation_template_id: Uuid.nullable().optional(),
    welcome_template_id: Uuid.nullable().optional(),
    goodbye_template_id: Uuid.nullable().optional(),
    /**
     * Kam po potvrzení a po odhlášení. Prázdný řetězec je „žádné přesměrování",
     * překládá ho `emptyToNull` v repozitáři; `ck_lists__*_redirect_url_len`
     * prázdnou hodnotu zakazuje.
     */
    confirm_redirect_url: z.string().max(2000).nullable().optional(),
    unsubscribe_redirect_url: z.string().max(2000).nullable().optional(),
    /**
     * Rozsah odhlášení z odkazu v e-mailu tohohle seznamu.
     *
     * Výchozí `list` je dnešní chování. `global` NENÍ jen širší rozsah: navíc
     * zakládá blokaci adresy pro CELÝ projekt (`lists/unsubscribe.ts`), takže
     * se na něj přepíná vědomě a změna se zapisuje do auditu.
     */
    unsubscribe_scope: z.enum(['list', 'global']).default('list'),
    /**
     * Vlastní stránka pro toho, kdo v seznamu už potvrzený je. `null` znamená
     * dnešní chování, tedy tatáž děkovací stránka jako u nového zájemce.
     *
     * Vyplněná adresa VĚDOMĚ prolamuje jednotnou odpověď formuláře (R9): jiná
     * odpověď na známou adresu prozradí, kdo v databázi je. Proto je výchozí
     * `null` a proto o zapnutí rozhoduje správce, ne produkt.
     */
    already_subscribed_redirect_url: z.string().max(2000).nullable().optional(),
    /** Odkazy na veřejné stránky, viz `ListSchema`. `null` vrací vestavěný text. */
    confirmed_template_id: Uuid.nullable().optional(),
    already_subscribed_template_id: Uuid.nullable().optional(),
    unsubscribed_template_id: Uuid.nullable().optional(),
    is_default: z.boolean().default(false),
    /**
     * Nabízet seznam ve veřejném centru předvoleb k PŘIHLÁŠENÍ?
     *
     * Výchozí `false` je bezpečnostní rozhodnutí, ne opatrnost: seznam je nositelem
     * oprávnění k rozesílce, takže zapnuté nabízení znamená „kdokoli s odhlašovacím
     * odkazem se sem smí přihlásit sám". U seznamu jako „VIP" je to nárok zdarma.
     * Odhlášení se tím NEŘÍDÍ, to jde vždycky.
     */
    public_visible: z.boolean().default(false),
    /** Název pro příjemce. Když chybí, ukáže se pracovní `name`. */
    public_name: z.string().min(1).max(120).nullable().optional(),
    public_description: z.string().min(1).max(500).nullable().optional(),
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
    send_goodbye: row.sendGoodbye,
    confirmation_template_id: row.confirmationTemplateId,
    welcome_template_id: row.welcomeTemplateId,
    goodbye_template_id: row.goodbyeTemplateId,
    confirm_redirect_url: row.confirmRedirectUrl,
    unsubscribe_redirect_url: row.unsubscribeRedirectUrl,
    unsubscribe_scope: row.unsubscribeScope,
    already_subscribed_redirect_url: row.alreadySubscribedRedirectUrl,
    confirmed_template_id: row.confirmedTemplateId,
    already_subscribed_template_id: row.alreadySubscribedTemplateId,
    unsubscribed_template_id: row.unsubscribedTemplateId,
    is_default: row.isDefault,
    public_visible: row.publicVisible,
    public_name: row.publicName,
    public_description: row.publicDescription,
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
          schema: z
            .object({ subscribers: z.array(SubscribeSchema).min(1).max(BULK_LIMIT) })
            .strict(),
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

/**
 * Hromadné odhlášení. Protějšek `subscribe:bulk` a drží jeho tvar: tentýž strop,
 * výsledek po položkách a tytéž chybové kódy.
 *
 * METODA DELETE SE STEJNOU CESTOU, protože jednotlivá dvojice je `POST /subscribe`
 * a `DELETE /subscribe`. Kdyby hromadné odhlášení bylo POST na vlastní cestě, měl by
 * produkt na dvě stejné věci dva různé tvary.
 *
 * Tělo nese jen adresy: u odhlášení nemá co dorovnávat jméno ani atributy, a čím míň
 * toho endpoint přijme, tím míň se dá omylem přepsat.
 */
const bulkUnsubscribeRoute = createRoute({
  method: 'delete',
  path: '/lists/{id}/subscribe:bulk',
  tags: [TAG],
  summary: 'Hromadné odhlášení, nejvýš tisíc adres',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    headers: IdempotencyHeaderSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({ emails: z.array(EmailInput).min(1).max(BULK_LIMIT) }).strict(),
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
                /**
                 * `unchanged` je kontakt, který v seznamu není nebo v něm odhlášený už je.
                 * `unknown_contact` je adresa, ke které v projektu žádný kontakt není.
                 */
                outcome: z.enum(['unsubscribed', 'unchanged', 'unknown_contact']),
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

/**
 * Hromadné potvrzení čekajících přihlášení. Je to zásah správce, ne projev vůle příjemce,
 * takže si vyžádá TÉŽ výslovné prohlášení jako zkratka v `subscribe:bulk`: bez
 * `declaration: true` se nestane nic. Prohlášení je jediná věc, kterou tělo nese;
 * koho se to týká, určuje seznam a stav přihlášení, ne volající.
 */
const confirmPendingRoute = createRoute({
  method: 'post',
  path: '/lists/{id}/subscriptions:confirm-pending',
  tags: [TAG],
  summary: 'Potvrdí čekající přihlášení seznamu na základě doloženého souhlasu',
  security: [{ bearerAuth: ['lists:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': { schema: z.object({ declaration: z.boolean() }).strict() },
      },
    },
  },
  responses: {
    200: {
      description: 'Kolik čekalo, potvrdilo se a vynechalo',
      content: {
        'application/json': {
          schema: z.object({
            pending: z.number().int(),
            confirmed: z.number().int(),
            skipped: z.number().int(),
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

/**
 * ZÁVORY PŘI PŘIPOJENÍ ŠABLONY K SEZNAMU.
 *
 * Dvě pravidla, obě vlastnost VAZBY, ne šablony, takže tentýž dokument může
 * projít v jedné roli a v druhé ne. Doména šablon o nich nic neví a vědět nemá.
 *
 * 1. POTVRZOVACÍ e-mail musí nést odkaz na potvrzení. Bez něj dostane člověk
 *    zprávu, ze které přihlášení dokončit nejde, a nic přitom nespadne: render
 *    s `strictVariables: false` udělá z chybějící proměnné prázdný `href`.
 * 2. UVÍTACÍ a ROZLOUČOVACÍ e-mail NESMÍ nést odhlašovací odkaz. Odcházejí jako
 *    `messages.kind = 'transactional'` a sender u toho druhu odhlašovací odkaz
 *    nevyrábí, `worker.go` ho v render datech bezpodmínečně přepíše prázdným
 *    řetězcem. Odkaz by tedy vedl do prázdna. Že to blokuje uložení a není to
 *    varování, rozhodl vedoucí týmu 5. 8. 2026.
 *
 * Tytéž dvě závory jsou i na uložení šablony (`templates/service.ts`, funkce
 * `saveDesign`), protože obsah jde upravit kdykoli potom, co se připojila,
 * a u potvrzovacího e-mailu ještě potřetí na odeslání. Není to duplicita:
 * každá chytá jiný okamžik a jen ta poslední zabrání odeslání.
 */
async function assertListEmailTemplate(
  ctx: WorkspaceContext,
  role: 'confirmation' | 'welcome' | 'goodbye',
  field: string,
  templateId: string | null | undefined,
): Promise<void> {
  if (templateId === undefined || templateId === null) return;

  const fields = await getFieldCatalog(ctx);
  const template = await withWorkspace(ctx, async (tx) => findTemplateById(tx, ctx, templateId));
  // Neexistující šablonu neřeší tahle závora, ale cizí klíč: zápis skončí 409.
  // Tady se mlčí, aby z odpovědi nešlo zjišťovat, které identifikátory existují.
  if (template === undefined) return;
  const document = template.design as Document;

  if (role === 'confirmation' && !documentHasConfirmLink(document, fields)) {
    throw validationFailed([
      {
        path: field,
        code: 'confirmation_template_missing_confirm_link',
        message:
          'Potvrzovací e-mail musí obsahovat odkaz na potvrzení, tedy {{ data.confirm_url }} v tlačítku nebo v odkazu. Bez něj se přihlášení nedá dokončit.',
      },
    ]);
  }

  if (role !== 'confirmation' && documentUsesUnsubscribeUrl(document, fields)) {
    throw validationFailed([
      {
        path: field,
        code: 'subscription_email_has_unsubscribe_link',
        message:
          'Tenhle e-mail odchází jako transakční zpráva, takže odhlašovací odkaz v něm vede do prázdna. Vypněte odhlášení v patičce, případně odkaz na {{ unsubscribe_url }} odeberte z textu.',
      },
    ]);
  }
}

/** Všechny tři vazby jednoho těla naráz. Pořadí je dané tvarem obrazovky. */
async function assertListEmailTemplates(
  ctx: WorkspaceContext,
  body: {
    confirmation_template_id?: string | null | undefined;
    welcome_template_id?: string | null | undefined;
    goodbye_template_id?: string | null | undefined;
  },
): Promise<void> {
  await assertListEmailTemplate(
    ctx,
    'confirmation',
    'confirmation_template_id',
    body.confirmation_template_id,
  );
  await assertListEmailTemplate(ctx, 'welcome', 'welcome_template_id', body.welcome_template_id);
  await assertListEmailTemplate(ctx, 'goodbye', 'goodbye_template_id', body.goodbye_template_id);
}

/**
 * Odkazy na veřejné stránky z těla, pojmenované PŘESNĚ TAK, jak je klient poslal.
 * Kontroluje je `assertPageTemplateRefs`, tedy tatáž závora jako u formuláře:
 * jedna kopie pravidla pro obě obrazovky, aby se nerozešly.
 */
function pageRefsOf(body: {
  confirmed_template_id?: string | null | undefined;
  already_subscribed_template_id?: string | null | undefined;
  unsubscribed_template_id?: string | null | undefined;
}): Record<string, string | null | undefined> {
  return {
    confirmed_template_id: body.confirmed_template_id,
    already_subscribed_template_id: body.already_subscribed_template_id,
    unsubscribed_template_id: body.unsubscribed_template_id,
  };
}

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
    await assertListEmailTemplates(ctx, body);
    await assertPageTemplateRefs(ctx, pageRefsOf(body));
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
      sendGoodbye: body.send_goodbye,
      ...(body.confirmation_template_id === undefined
        ? {}
        : { confirmationTemplateId: body.confirmation_template_id }),
      ...(body.welcome_template_id === undefined
        ? {}
        : { welcomeTemplateId: body.welcome_template_id }),
      ...(body.goodbye_template_id === undefined
        ? {}
        : { goodbyeTemplateId: body.goodbye_template_id }),
      ...(body.confirm_redirect_url === undefined
        ? {}
        : { confirmRedirectUrl: body.confirm_redirect_url }),
      ...(body.unsubscribe_redirect_url === undefined
        ? {}
        : { unsubscribeRedirectUrl: body.unsubscribe_redirect_url }),
      unsubscribeScope: body.unsubscribe_scope,
      ...(body.already_subscribed_redirect_url === undefined
        ? {}
        : { alreadySubscribedRedirectUrl: body.already_subscribed_redirect_url }),
      ...(body.confirmed_template_id === undefined
        ? {}
        : { confirmedTemplateId: body.confirmed_template_id }),
      ...(body.already_subscribed_template_id === undefined
        ? {}
        : { alreadySubscribedTemplateId: body.already_subscribed_template_id }),
      ...(body.unsubscribed_template_id === undefined
        ? {}
        : { unsubscribedTemplateId: body.unsubscribed_template_id }),
      isDefault: body.is_default,
      publicVisible: body.public_visible,
      ...(body.public_name === undefined ? {} : { publicName: body.public_name }),
      ...(body.public_description === undefined
        ? {}
        : { publicDescription: body.public_description }),
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
    await assertListEmailTemplates(ctx, body);
    await assertPageTemplateRefs(ctx, pageRefsOf(body));
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
      ...(body.send_goodbye === undefined ? {} : { sendGoodbye: body.send_goodbye }),
      ...(body.confirmation_template_id === undefined
        ? {}
        : { confirmationTemplateId: body.confirmation_template_id }),
      ...(body.welcome_template_id === undefined
        ? {}
        : { welcomeTemplateId: body.welcome_template_id }),
      ...(body.goodbye_template_id === undefined
        ? {}
        : { goodbyeTemplateId: body.goodbye_template_id }),
      ...(body.confirm_redirect_url === undefined
        ? {}
        : { confirmRedirectUrl: body.confirm_redirect_url }),
      ...(body.unsubscribe_redirect_url === undefined
        ? {}
        : { unsubscribeRedirectUrl: body.unsubscribe_redirect_url }),
      ...(body.unsubscribe_scope === undefined ? {} : { unsubscribeScope: body.unsubscribe_scope }),
      ...(body.already_subscribed_redirect_url === undefined
        ? {}
        : { alreadySubscribedRedirectUrl: body.already_subscribed_redirect_url }),
      ...(body.confirmed_template_id === undefined
        ? {}
        : { confirmedTemplateId: body.confirmed_template_id }),
      ...(body.already_subscribed_template_id === undefined
        ? {}
        : { alreadySubscribedTemplateId: body.already_subscribed_template_id }),
      ...(body.unsubscribed_template_id === undefined
        ? {}
        : { unsubscribedTemplateId: body.unsubscribed_template_id }),
      ...(body.public_visible === undefined ? {} : { publicVisible: body.public_visible }),
      ...(body.public_name === undefined ? {} : { publicName: body.public_name }),
      ...(body.public_description === undefined
        ? {}
        : { publicDescription: body.public_description }),
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

  app.openapi(bulkUnsubscribeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    const listId = c.req.valid('param').id;
    // Neexistující seznam se musí ozvat 404. Bez téhle kontroly by odhlášení z překlepu
    // v identifikátoru vrátilo samá `unchanged` a vypadalo by jako práce.
    if ((await listById(ctx, listId, { includeArchived: true })) === null) {
      throw new ApiError('not_found');
    }

    const results = await bulkUnsubscribeFromList(ctx, {
      listId,
      emails: c.req.valid('json').emails,
      // `manual` je rozhodnutí správce, ne projev vůle příjemce: do souhlasu se zapíše
      // zdroj `admin`, viz `consentSourceFor`. Hromadné odhlášení nikdy nespustí sám
      // příjemce, ten má stránku předvoleb a odhlašovací odkaz.
      reason: 'manual',
    });

    return c.json(
      {
        results: results.map((item) => ({
          index: item.index,
          outcome: item.outcome,
          contact_id: item.contactId,
        })),
      },
      200,
    );
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

  app.openapi(confirmPendingRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'lists:write');
    // Bez prohlášení se nestane vůbec nic a volající to musí poznat. Tiché „potvrzeno 0"
    // by z chybějícího příznaku udělalo záhadu, kterou by nikdo nehledal v těle požadavku.
    if (!c.req.valid('json').declaration) {
      throw new ApiError('validation_failed', { params: { detail: 'declaration_required' } });
    }
    return c.json(await confirmPendingSubscriptions(ctx, c.req.valid('param').id), 200);
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
