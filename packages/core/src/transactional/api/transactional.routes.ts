import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { loadConfig, type MlainConfig } from '../../config';
import { ApiError } from '../../errors/api-error';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { sendTransactional, TransactionalSendError, TRANSACTIONAL_DATA_MAX_BYTES } from '../send';
import { findTransactionalStatus } from '../status';

const TAG = 'Transactional';

/**
 * Konfigurace se čte líně a memoizovaně, stejně jako v doméně šablon.
 * `loadConfig()` hází `ConfigError`, když chybí proměnná prostředí, takže
 * volání při importu modulu by shodilo i cesty, které konfiguraci nepotřebují.
 */
let cachedConfig: MlainConfig | null = null;
function config(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * Hlavička idempotence je u téhle cesty POVINNÁ, ne volitelná.
 *
 * Je to jediná ochrana proti tomu, aby opakovaný pokus v aplikaci zákazníka
 * poslal uživateli reset hesla třikrát. Runner `setIdempotentRunner` ji u POST
 * vyžaduje sám, tahle deklarace je pro dokumentaci.
 */
const IdempotencyHeader = z.object({
  'Idempotency-Key': z
    .string()
    .min(8)
    .max(255)
    .openapi({ description: 'Povinná. 8 až 255 znaků z [A-Za-z0-9._:-].' }),
});

const RecipientSchema = z
  .object({
    email: z.email().max(254),
    name: z.string().max(200).optional(),
  })
  .openapi('TransactionalRecipient');

const TransactionalSendRequest = z
  .object({
    template_id: z.uuid().openapi({
      description: 'Šablona s kind = "transactional". Jiný druh skončí na 422.',
    }),
    to: RecipientSchema,
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({
        description:
          'Hodnoty pro kořen `data` v šabloně, tedy `{{ data.reset_url }}`. ' +
          `Nejvýš ${TRANSACTIONAL_DATA_MAX_BYTES} bajtů po serializaci. ` +
          'Proměnná, kterou šablona používá a volání ji nedodá, je chyba, ne prázdný řetězec.',
      }),
    sender_identity_id: z.uuid().optional().openapi({
      description: 'Bez ní se vezme výchozí odesílací identita projektu.',
    }),
    reply_to: z.email().max(254).optional(),
    tags: z.array(z.string().max(64)).max(10).optional().openapi({
      description: 'Rozpad v reportu. NENÍ to tagování kontaktu.',
    }),
    create_contact: z
      .boolean()
      .optional()
      .openapi({
        description:
          'Výchozí true. Neznámá adresa se založí jako kontakt BEZ marketingového ' +
          'souhlasu, bez přihlášení do seznamu a se zdrojem "api". Při false ' +
          'a neznámé adrese vrací 422 recipient_unknown.',
      }),
  })
  .openapi('TransactionalSendRequest');

const TransactionalSendResponse = z
  .object({
    message_id: z.uuid(),
    status: z.literal('queued'),
    contact_id: z.uuid(),
    campaign_id: z.uuid(),
    created_at: z.string(),
    warnings: z.array(
      z.object({ code: z.string(), params: z.record(z.string(), z.unknown()).optional() }),
    ),
  })
  .openapi('TransactionalSendResponse');

const sendRoute = createRoute({
  method: 'post',
  path: '/transactional',
  tags: [TAG],
  summary: 'Odeslání jedné transakční zprávy',
  description:
    'Transakční sdělení je plnění smlouvy nebo oprávněný zájem, například reset ' +
    'hesla nebo potvrzení objednávky. Zpráva nenese odhlašovací odkaz ani ' +
    'hlavičku List-Unsubscribe a neměří se u ní otevření ani prokliky. ' +
    'Marketing tudy posílat NELZE: „vaše objednávka byla odeslána, a mrkněte na ' +
    'tyhle produkty" je marketing, i když jde tímhle rozhraním, a odpovědnost ' +
    'za to nese odesílatel.',
  security: [{ bearerAuth: ['transactional:send'] }],
  request: {
    headers: IdempotencyHeader,
    body: { content: { 'application/json': { schema: TransactionalSendRequest } } },
  },
  responses: {
    202: {
      description:
        'Zpráva je ve frontě. Odesílá ji sender, ne tenhle požadavek. ' +
        'Opakované volání s týmž Idempotency-Key vrátí tutéž odpověď a druhý mail neodejde.',
      content: { 'application/json': { schema: TransactionalSendResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse(
      'conflict',
      'idempotency_key_reuse',
      'idempotency_request_in_progress',
      'sending_not_configured',
    ),
    413: problemResponse('transactional_data_too_large'),
    422: problemResponse(
      'validation_failed',
      'template_kind_not_transactional',
      'template_not_compilable',
      'recipient_suppressed',
      'recipient_unknown',
      'transactional_variable_unknown',
      'sender_identity_not_found',
    ),
    429: problemResponse('rate_limited'),
  },
});

const TransactionalStatusResponse = z
  .object({
    message_id: z.uuid(),
    status: z.enum(['queued', 'sent', 'failed', 'skipped']).openapi({
      description:
        '`queued` je zpráva ve frontě, včetně té, kterou si právě vzal odesílací ' +
        'proces. `sent` znamená předáno provideru, ne doručeno do schránky. ' +
        '`failed` je vyčerpaný pokus o odeslání, `skipped` zpráva, která se ' +
        'nakonec neposlala (například blokovaná adresa).',
    }),
    contact_id: z.uuid(),
    campaign_id: z.uuid().nullable(),
    created_at: z.string(),
    sent_at: z.string().nullable(),
    attempts: z.number().int(),
    error_code: z.string().nullable().openapi({
      description: 'Kód z uzavřeného registru chyb. Podle něj se dá rozhodovat v kódu.',
    }),
    provider_message_id: z.string().nullable().openapi({
      description: 'Identifikátor u odesílajícího providera. Pro dohledání v jeho konzoli.',
    }),
  })
  .openapi('TransactionalStatusResponse');

/**
 * Dohledání stavu odeslané transakční zprávy.
 *
 * PROČ `transactional:send` A NE VLASTNÍ ČTECÍ OPRÁVNĚNÍ. Klíč, který zprávu
 * poslal, se musí umět zeptat, jak dopadla; to je táž operace rozdělená na dva
 * kroky, ne druhá pravomoc. Nové oprávnění `transactional:read` by navíc
 * znamenalo, že už vydané klíče dostanou na tuhle cestu 403, tedy že se slib
 * „stav se dá dohledat" splní jen novým klíčům. Průzkum
 * (`docs/superpowers/specs/2026-08-05-transakcni-maily-pruzkum.md`) tady počítá
 * se stejným scopem.
 *
 * NENÍ TO CESTA K DORUČENÍ. `sent` znamená „provider zprávu převzal". Jestli
 * dopadla do schránky, odrazila se nebo si na ni někdo stěžoval, tahle tabulka
 * neví; to nese `message_events` a chodilo by to odchozími webhooky, které pro
 * doručení, odraz a stížnost zatím NEEXISTUJÍ (posílají se jen `message.opened`
 * a `message.clicked`). Popis to říká schválně, aby si na to nikdo nepostavil
 * potvrzování objednávek.
 */
const statusRoute = createRoute({
  method: 'get',
  path: '/transactional/{id}',
  tags: [TAG],
  summary: 'Stav odeslané transakční zprávy',
  description:
    'Stav zprávy, kterou vrátilo `POST /transactional` jako `message_id`. ' +
    'Odpovídá jen na zprávy s `kind = "transactional"`: zprávy kampaní ani ' +
    'testovací odeslání tudy číst NELZE a vypadají jako neexistující. ' +
    '`sent` znamená, že zprávu převzal provider, NE že dorazila do schránky.',
  security: [{ bearerAuth: ['transactional:send'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'Stav zprávy',
      content: { 'application/json': { schema: TransactionalStatusResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerTransactionalRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(statusRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'transactional:send');
    const status = await findTransactionalStatus(ctx, c.req.valid('param').id);
    if (status === null) throw new ApiError('not_found');
    return c.json(
      {
        message_id: status.messageId,
        status: status.status,
        contact_id: status.contactId,
        campaign_id: status.campaignId,
        created_at: status.createdAt.toISOString(),
        sent_at: status.sentAt === null ? null : status.sentAt.toISOString(),
        attempts: status.attempts,
        error_code: status.errorCode,
        provider_message_id: status.providerMessageId,
      },
      200,
    );
  });

  app.openapi(sendRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'transactional:send');
    const body = c.req.valid('json');

    // Runner vynutí hlavičku Idempotency-Key, uloží odpověď na 24 hodin a při
    // opakování ji přehraje. 202, ne 201: odeslání je asynchronní a v tuhle
    // chvíli je `messages.status` teprve `pending`.
    const result = await c.get('runIdempotent')(
      async () => {
        try {
          const sent = await sendTransactional(ctx, {
            templateId: body.template_id,
            to: { email: body.to.email, name: body.to.name },
            data: body.data,
            senderIdentityId: body.sender_identity_id,
            replyTo: body.reply_to,
            tags: body.tags,
            createContact: body.create_contact,
            assetBaseUrl: config().ASSET_BASE_URL,
          });
          return {
            message_id: sent.messageId,
            status: 'queued' as const,
            contact_id: sent.contactId,
            campaign_id: sent.campaignId,
            created_at: sent.createdAt.toISOString(),
            warnings: sent.warnings,
          };
        } catch (error) {
          translateSendError(error);
        }
      },
      { successStatus: 202 },
    );
    return c.json(result.body as never, result.status as never);
  });
}

/**
 * Překlad doménových chyb na RFC 9457.
 *
 * `TransactionalSendError` nese přímo kořenový kód z registru, takže se jen
 * přebalí. Výjimkou je `validation_failed`, které potřebuje pole `errors`:
 * aplikace zákazníka z něj pozná, které pole má opravit.
 */
function translateSendError(error: unknown): never {
  if (!(error instanceof TransactionalSendError)) throw error;
  const params = error.params ?? {};
  switch (error.message) {
    case 'validation_failed':
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: String(params['field'] ?? 'to.email'),
            code: 'invalid_value',
            message: 'Neplatná e-mailová adresa.',
          },
        ],
      });
    case 'template_kind_not_transactional':
    case 'template_not_compilable':
    case 'recipient_suppressed':
    case 'recipient_unknown':
    case 'transactional_data_too_large':
    case 'transactional_variable_unknown':
    case 'sender_identity_not_found':
    case 'sending_not_configured':
    case 'not_found':
      throw new ApiError(error.message, { params });
    default:
      throw error;
  }
}
