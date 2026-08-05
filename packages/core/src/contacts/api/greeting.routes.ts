import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { alignGreetingLocale, greetingLocaleSummary } from '../greeting-locale';
import { clearGreetingOverride, setGreetingOverride } from '../repo/greeting-override';
import type { ContactsEnv } from './index';
import { ContactResponseSchema, IdParam, problemResponse } from './schemas';

const TAG = 'Contacts';

/**
 * RUČNÍ TVAR OSLOVENÍ U JEDNOHO KONTAKTU.
 *
 * Vlastní cesta, ne pole ve `PUT /contacts/{id}`. Důvod je v tom, co znamená zápis:
 * editační formulář posílá celý stav obrazovky a chybějící hodnota u něj znamená
 * „má být prázdné". Kdyby se ruční vokativ posílal tudy, každé uložení formuláře
 * bez toho pole by ruční opravu zase smazalo, a to je přesně ten tichý přepis,
 * proti kterému zámek `vocative_locked` vznikl.
 *
 * Segment `/greeting` navíc znamená, že se cesta nestíní s `/contacts/{id}`:
 * má o segment víc, stejně jako `/contacts/{id}/cancel-snooze`.
 */
const GreetingOverrideRequestSchema = z
  .object({
    /**
     * Tvar křestního jména v 5. pádu, tedy „Petře". `null` nebo prázdný řetězec
     * znamená „oslovovat bez jména": kontakt dostane neutrální „Dobrý den" a zámek
     * se ZAPNE, aby to příští import nepřepsal zpátky.
     */
    first_name_vocative: z.string().max(100).nullable(),
    /** Tvar příjmení v 5. pádu. Vynechaný klíč hodnotu NEMĚNÍ. */
    last_name_vocative: z.string().max(100).nullable().optional(),
  })
  .strict()
  .openapi('GreetingOverrideRequest');

const setRoute = createRoute({
  method: 'put',
  path: '/contacts/{id}/greeting',
  tags: [TAG],
  summary: 'Ruční tvar oslovení, zamkne kontakt proti přepočtu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: GreetingOverrideRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Oslovení uloženo a zamknuto',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const clearRoute = createRoute({
  method: 'delete',
  path: '/contacts/{id}/greeting',
  tags: [TAG],
  summary: 'Zrušení ručního tvaru, oslovení se spočítá znovu',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Zámek zrušen, oslovení přepočítáno',
      content: { 'application/json': { schema: z.object({ data: ContactResponseSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

/**
 * JAZYK OSLOVENÍ CELÉHO PROJEKTU. Vlastní kořen `/greeting-locale`, ne cesta pod
 * `/contacts`: kdyby to byl `/contacts/greeting-locale`, stínila by ho dřív
 * zaregistrovaná `/contacts/{id}` a požadavek by skončil na kontrole tvaru
 * identifikátoru. Je to navíc operace nad PROJEKTEM, ne nad kontaktem.
 */
const GreetingLocaleSummarySchema = z
  .object({
    workspace_locale: z.string(),
    total: z.number().int(),
    mismatched: z.number().int(),
    by_locale: z.array(z.object({ locale: z.string(), count: z.number().int() })),
  })
  .openapi('GreetingLocaleSummary');

const localeSummaryRoute = createRoute({
  method: 'get',
  path: '/greeting-locale',
  tags: [TAG],
  summary: 'Kolik kontaktů má jiný jazyk oslovení než projekt',
  security: [{ bearerAuth: ['contacts:read'] }],
  responses: {
    200: {
      description: 'Přehled jazyků kontaktů',
      content: { 'application/json': { schema: z.object({ data: GreetingLocaleSummarySchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const localeAlignRoute = createRoute({
  method: 'post',
  path: '/greeting-locale:align',
  tags: [TAG],
  summary: 'Sjednotí jazyk oslovení kontaktů s jazykem projektu a přepočítá oslovení',
  security: [{ bearerAuth: ['contacts:write'] }],
  responses: {
    202: {
      description: 'Přepočet zařazen do fronty',
      content: {
        'application/json': {
          schema: z.object({
            mode: z.literal('queued'),
            locale: z.string(),
            affected: z.number().int(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

export function registerGreetingRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(localeSummaryRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const summary = await greetingLocaleSummary(ctx);
    return c.json(
      {
        data: {
          workspace_locale: summary.workspaceLocale,
          total: summary.total,
          mismatched: summary.mismatched,
          by_locale: summary.byLocale,
        },
      },
      200,
    );
  });

  app.openapi(localeAlignRoute, async (c) => {
    const { ctx } = c.get('auth');
    const result = await alignGreetingLocale(ctx);
    return c.json(result, 202);
  });

  app.openapi(setRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const body = c.req.valid('json');
    const row = await setGreetingOverride(ctx, c.req.valid('param').id, {
      firstNameVocative: body.first_name_vocative,
      ...(body.last_name_vocative === undefined
        ? {}
        : { lastNameVocative: body.last_name_vocative }),
    });
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });

  app.openapi(clearRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const row = await clearGreetingOverride(ctx, c.req.valid('param').id);
    if (row === null) throw new ApiError('not_found');
    return c.json({ data: row }, 200);
  });
}
