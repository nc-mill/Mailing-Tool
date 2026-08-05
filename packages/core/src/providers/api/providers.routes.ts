import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { loadConfig } from '../../config/index';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import { DOMAIN_CHECK_MIN_INTERVAL_SECONDS } from '../../campaigns/constants';
import {
  buildDeliverabilitySettingsSchema,
  type DeliverabilityInstallationLimits,
} from '../../campaigns/settings';
import { readWorkspaceSettings, writeWorkspaceSettingsKey } from '../../campaigns/api/service';
import { deleteProvider, getProviderById, setDefaultProvider } from '../repo/provider';
import { getDomain } from '../repo/domain';
import {
  addDomain,
  checkDomainNow,
  createProviderFromApi,
  deleteDomain,
  domainRecords,
  emailIdentityStatus,
  listDomains,
  listProviderIdentities,
  listProviders,
  presentProvider,
  providerRegion,
  refreshQuota,
  requestProductionAccess,
  secondsSinceLastCheck,
  setMailFrom,
  testProviderConnection,
  updateProviderFromApi,
  verifyEmailIdentity,
} from './service';
import type { ProvidersEnv } from './index';

const TAG = 'Sending';

const Uuid = z.uuid();
const IdParam = z.object({ id: Uuid });

const DnsRecordSchema = z
  .object({
    type: z.string(),
    name: z.string(),
    value: z.string(),
    ttl: z.number().int(),
    purpose: z.string(),
    required: z.boolean(),
  })
  .openapi('DnsRecord');

const ProviderSchema = z.record(z.string(), z.unknown()).openapi('SendingProvider');
const DomainSchema = z.record(z.string(), z.unknown()).openapi('SenderDomain');

const CreateProviderRequest = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('ses'),
        name: z.string().min(1).max(120),
        region: z.string().min(1).max(40),
        access_key_id: z.string().min(16).max(128),
        secret_access_key: z.string().min(16).max(256),
        configuration_set_name: z.string().min(1).max(64).optional(),
        is_default: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('smtp'),
        name: z.string().min(1).max(120),
        host: z.string().min(1).max(255),
        port: z.number().int(),
        username: z.string().min(1).max(255),
        password: z.string().min(1).max(512),
        encryption: z.enum(['starttls', 'tls', 'none']),
        is_default: z.boolean().optional(),
      })
      .strict(),
  ])
  .openapi('CreateSendingProviderRequest');

/*
 * Tělo úpravy je záměrně bez `type`: typ účtu se nemění, mění se jeho nastavení.
 * Tajemství se posílají JEN když je uživatel opravdu vyplnil, protože zpátky se
 * nikdy nevracejí a prázdná hodnota by znamenala „vymaž mi klíč".
 *
 * `region` a `configuration_set_name` doplnil požadavek na opravu údajů: bez nich
 * se špatně zadaný region nedal spravit jinak než smazáním celého účtu.
 */
const PatchProviderRequest = z
  .object({
    name: z.string().min(1).max(120).optional(),
    access_key_id: z.string().min(16).max(128).optional(),
    secret_access_key: z.string().min(16).max(256).optional(),
    region: z.string().min(1).max(40).optional(),
    configuration_set_name: z.string().min(1).max(64).optional(),
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().optional(),
    username: z.string().min(1).max(255).optional(),
    password: z.string().min(1).max(512).optional(),
    encryption: z.enum(['starttls', 'tls', 'none']).optional(),
  })
  .strict()
  .openapi('PatchSendingProviderRequest');

const listProvidersRoute = createRoute({
  method: 'get',
  path: '/providers',
  tags: [TAG],
  summary: 'Odesílací účty projektu',
  security: [{ bearerAuth: ['providers:read'] }],
  responses: {
    200: {
      description: 'Účty, vždy jen s maskovanými přístupovými údaji',
      content: { 'application/json': { schema: z.object({ data: z.array(ProviderSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createProviderRoute = createRoute({
  method: 'post',
  path: '/providers',
  tags: [TAG],
  summary: 'Nový odesílací účet',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateProviderRequest } } } },
  responses: {
    201: { description: 'Založeno', content: { 'application/json': { schema: ProviderSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const patchProviderRoute = createRoute({
  method: 'patch',
  path: '/providers/{id}',
  tags: [TAG],
  summary: 'Úprava odesílacího účtu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchProviderRequest } } },
  },
  responses: {
    200: {
      description: 'Upraveno',
      content: {
        'application/json': {
          schema: z.object({
            provider: ProviderSchema,
            credentials_rotated: z.boolean(),
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

const deleteProviderRoute = createRoute({
  method: 'delete',
  path: '/providers/{id}',
  tags: [TAG],
  summary: 'Smazání odesílacího účtu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const testProviderRoute = createRoute({
  method: 'post',
  path: '/providers/{id}/test',
  tags: [TAG],
  summary: 'Test připojení',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Připojení funguje',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.literal(true),
            detail: z.string(),
            /** Účet v sandboxu je funkční účet s omezením, ne chyba. */
            sandbox: z.boolean(),
            /**
             * Stav účtu PO zápisu, ne před ním. Obrazovka z něj kreslí odznak,
             * takže odznak a výsledek testu pocházejí z jedné odpovědi a nemají
             * jak tvrdit opak. Dřív odznak vycházel z odděleně načteného seznamu
             * a vznikaly snímky s odznakem „Neověřený" vedle věty „Ověřeno".
             */
            status: z.string(),
            status_detail: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    // Výčet je úplný, ne zkrácený: `verifySmtp` vrací všech sedm kódů a dokument,
    // který zná jen dva z nich, je dokument, podle kterého se klient nezařídí.
    422: problemResponse(
      'provider_credentials_invalid',
      'provider_smtp_auth_failed',
      'provider_smtp_host_unknown',
      'provider_smtp_connection_refused',
      'provider_smtp_tls_invalid',
      'provider_smtp_timeout',
      'provider_smtp_starttls_unsupported',
      'provider_smtp_greeting_invalid',
    ),
  },
});

const quotaRoute = createRoute({
  method: 'get',
  path: '/providers/{id}/quota',
  tags: [TAG],
  summary: 'Čerstvý stav účtu u Amazonu',
  security: [{ bearerAuth: ['providers:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Stav účtu',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const defaultRoute = createRoute({
  method: 'post',
  path: '/providers/{id}/default',
  tags: [TAG],
  summary: 'Nastavení výchozího účtu',
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

/*
 * OVĚŘENÍ ADRESY ODESÍLATELE PŘÍMO Z NAŠÍ APLIKACE.
 *
 * Tři koncové body, které dohromady nahrazují cestu do konzole Amazonu:
 * seznam toho, co je v regionu ověřené, založení identity pro jednu adresu
 * a dotaz na její stav. Region je součástí KAŽDÉ odpovědi, protože seznam
 * identit bez uvedení regionu je tvrzení, které se nedá ověřit.
 */
const IdentitySchema = z
  .object({
    identity: z.string(),
    kind: z.enum(['domain', 'email', 'unknown']),
    verified: z.boolean(),
    status: z.enum([
      'verified',
      'pending',
      'failed',
      'temporary_failure',
      'not_started',
      'unknown',
    ]),
  })
  .openapi('SesIdentity');

const EmailIdentitySchema = z
  .object({
    region: z.string(),
    email: z.string(),
    status: z.enum([
      'verified',
      'pending',
      'failed',
      'temporary_failure',
      'not_started',
      'unknown',
    ]),
    verified: z.boolean(),
    already_existed: z.boolean(),
  })
  .openapi('SesEmailIdentity');

const listIdentitiesRoute = createRoute({
  method: 'get',
  path: '/providers/{id}/identities',
  tags: [TAG],
  summary: 'Co má účet ověřené v regionu účtu',
  security: [{ bearerAuth: ['providers:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Region účtu a identity, které v něm Amazon zná',
      content: {
        'application/json': {
          schema: z.object({ region: z.string(), identities: z.array(IdentitySchema) }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed', 'provider_credentials_invalid'),
  },
});

const verifyIdentityRoute = createRoute({
  method: 'post',
  path: '/providers/{id}/identities',
  tags: [TAG],
  summary: 'Ověření adresy odesílatele u Amazonu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': { schema: z.object({ email: z.string().min(6).max(254) }).strict() },
      },
    },
  },
  responses: {
    200: {
      description: 'Amazon adresu přijal a poslal na ni potvrzovací e-mail',
      content: { 'application/json': { schema: EmailIdentitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed', 'provider_credentials_invalid'),
  },
});

const identityStatusRoute = createRoute({
  method: 'get',
  path: '/providers/{id}/identities/{identity}',
  tags: [TAG],
  summary: 'Stav jedné ověřované adresy',
  security: [{ bearerAuth: ['providers:read'] }],
  request: { params: z.object({ id: Uuid, identity: z.string().min(1).max(254) }) },
  responses: {
    200: {
      description: 'Stav adresy podle Amazonu',
      content: { 'application/json': { schema: EmailIdentitySchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed', 'provider_credentials_invalid'),
  },
});

/*
 * Žádost o produkční přístup. Povinné údaje jsou přesně ty, které chce Amazon
 * (`MailType` a `WebsiteURL`); zbytek je nepovinný a odpovídá `PutAccountDetails`.
 * `use_case_description` tady VĚDOMĚ NENÍ: dokumentace ho označuje za deprecated.
 */
const productionAccessRoute = createRoute({
  method: 'post',
  path: '/providers/{id}/production-access',
  tags: [TAG],
  summary: 'Žádost o vyřazení z testovacího režimu u Amazonu',
  security: [{ bearerAuth: ['providers:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              mail_type: z.enum(['MARKETING', 'TRANSACTIONAL']),
              website_url: z.string().min(1).max(1000),
              additional_contact_emails: z.array(z.string().min(6).max(254)).max(4).optional(),
              contact_language: z.enum(['EN', 'JA']).optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Žádost odešla a Amazon ji posuzuje',
      content: {
        'application/json': {
          schema: z.object({ region: z.string(), submitted: z.literal(true) }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    // 409 znamená „jednu žádost už posuzujeme", ne chybu ve vstupu.
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed', 'provider_credentials_invalid'),
  },
});

const listDomainsRoute = createRoute({
  method: 'get',
  path: '/domains',
  tags: [TAG],
  summary: 'Odesílací domény',
  security: [{ bearerAuth: ['domains:read'] }],
  responses: {
    200: {
      description: 'Domény',
      content: { 'application/json': { schema: z.object({ data: z.array(DomainSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createDomainRoute = createRoute({
  method: 'post',
  path: '/domains',
  tags: [TAG],
  summary: 'Nová odesílací doména',
  security: [{ bearerAuth: ['domains:write'] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ domain: z.string().min(1).max(255), provider_id: Uuid }).strict(),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Doména se záznamy k vložení',
      content: {
        'application/json': {
          schema: z.object({ domain: DomainSchema, records: z.array(DnsRecordSchema) }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const getDomainRoute = createRoute({
  method: 'get',
  path: '/domains/{id}',
  tags: [TAG],
  summary: 'Jedna doména se záznamy a stavem kontrol',
  security: [{ bearerAuth: ['domains:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Doména',
      content: {
        'application/json': {
          schema: z.object({
            domain: DomainSchema,
            records: z.array(DnsRecordSchema),
            checks: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const checkDomainRoute = createRoute({
  method: 'post',
  path: '/domains/{id}/check',
  tags: [TAG],
  summary: 'Kontrola DNS na jedno kliknutí',
  security: [{ bearerAuth: ['domains:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Výsledek kontroly',
      content: {
        'application/json': {
          schema: z.object({
            domain: DomainSchema,
            records: z.array(DnsRecordSchema),
            checks: z.record(z.string(), z.unknown()),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    429: problemResponse('rate_limited'),
  },
});

const mailFromRoute = createRoute({
  method: 'post',
  path: '/domains/{id}/mail-from',
  tags: [TAG],
  summary: 'Vlastní zpáteční adresa',
  security: [{ bearerAuth: ['domains:write'] }],
  request: {
    params: IdParam,
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              subdomain: z
                .string()
                .min(1)
                .max(63)
                .regex(/^[a-z0-9-]+$/),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Nastaveno",',
      content: {
        'application/json': {
          schema: z.object({ domain: DomainSchema, records: z.array(DnsRecordSchema) }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteDomainRoute = createRoute({
  method: 'delete',
  path: '/domains/{id}',
  tags: [TAG],
  summary: 'Smazání domény',
  security: [{ bearerAuth: ['domains:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const DeliverabilitySettingsSchema = z
  .object({
    bounce_guard_rate: z.number().optional(),
    complaint_guard_rate: z.number().optional(),
    bounce_warn_rate: z.number().optional(),
    complaint_warn_rate: z.number().optional(),
    guard_min_sent: z.number().int().optional(),
  })
  .strict()
  .openapi('DeliverabilitySettings');

const getGuardsRoute = createRoute({
  method: 'get',
  path: '/settings/deliverability',
  tags: [TAG],
  summary: 'Prahy doručitelnosti a stropy instalace',
  security: [{ bearerAuth: ['providers:read'] }],
  responses: {
    200: {
      description: 'Nastavení projektu a stropy, které nejdou překročit',
      content: {
        'application/json': {
          schema: z.object({
            settings: DeliverabilitySettingsSchema,
            limits: z.record(z.string(), z.number()),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const patchGuardsRoute = createRoute({
  method: 'patch',
  path: '/settings/deliverability',
  tags: [TAG],
  summary: 'Změna prahů, výhradně směrem k přísnosti',
  security: [{ bearerAuth: ['providers:write'] }],
  request: { body: { content: { 'application/json': { schema: DeliverabilitySettingsSchema } } } },
  responses: {
    200: {
      description: 'Uloženo',
      content: {
        'application/json': {
          schema: z.object({
            settings: DeliverabilitySettingsSchema,
            limits: z.record(z.string(), z.number()),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

function installationLimits(): DeliverabilityInstallationLimits {
  const cfg = loadConfig();
  return {
    DELIVERABILITY_BOUNCE_GUARD_RATE: cfg.DELIVERABILITY_BOUNCE_GUARD_RATE,
    DELIVERABILITY_COMPLAINT_GUARD_RATE: cfg.DELIVERABILITY_COMPLAINT_GUARD_RATE,
    DELIVERABILITY_BOUNCE_WARN_RATE: cfg.DELIVERABILITY_BOUNCE_WARN_RATE,
    DELIVERABILITY_COMPLAINT_WARN_RATE: cfg.DELIVERABILITY_COMPLAINT_WARN_RATE,
    DELIVERABILITY_GUARD_MIN_SENT: cfg.DELIVERABILITY_GUARD_MIN_SENT,
  };
}

export function registerProviderRoutes(app: OpenAPIHono<ProvidersEnv>): void {
  app.openapi(listProvidersRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const rows = await listProviders(ctx);
    return c.json({ data: rows.map(presentProvider) }, 200);
  });

  app.openapi(createProviderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const body = c.req.valid('json');
    const row = await createProviderFromApi(ctx, body, ctx.workspaceId.slice(0, 8));
    return c.json(presentProvider(row), 201);
  });

  app.openapi(patchProviderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const r = await updateProviderFromApi(ctx, c.req.valid('param').id, c.req.valid('json'));
    return c.json(
      { provider: presentProvider(r.row), credentials_rotated: r.credentialsRotated },
      200,
    );
  });

  app.openapi(deleteProviderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const id = c.req.valid('param').id;
    if (!(await getProviderById(ctx, id))) throw new ApiError('not_found');
    // `deleteProvider` sám vyhodí `conflict`, když má účet rozpracovanou kampaň.
    await deleteProvider(ctx, id);
    return c.body(null, 204);
  });

  app.openapi(testProviderRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const result = await testProviderConnection(ctx, c.req.valid('param').id);
    if (!result.ok) {
      // Výsledek jde INLINE k formuláři, ne jako oznámení, a nese mapovaný kód,
      // aby obrazovka mohla poradit konkrétní opravu. U SES je registrovaný kód
      // jen jeden, takže se vedle něj posílá ještě `reason`; bez něj by obrazovka
      // uměla říct pouze „Amazon to odmítl" a uživatel by nevěděl, co opravit.
      throw new ApiError(result.code as never, {
        params: {
          detail: result.detail,
          ...(result.reason === null ? {} : { reason: result.reason }),
          // Zapsaný stav jde i s chybou. Bez něj by obrazovka po nezdaru
          // kreslila odznak z předchozího načtení, tedy ze stavu, který
          // právě přestal platit.
          status: result.status,
          blockers: result.status_detail.blockers,
          // Region jde i s chybou. Uživatel se právě dozvěděl, že mu účet
          // nefunguje, a musí u toho vidět, KTERÉHO REGIONU se to týká.
          region: result.status_detail.region,
          verified_identities: result.status_detail.verified_identities,
          verified_identity_count: result.status_detail.verified_identity_count,
        },
      });
    }
    return c.json(
      {
        ok: true as const,
        detail: result.detail,
        sandbox: result.sandbox,
        status: result.status,
        status_detail: result.status_detail as unknown as Record<string, unknown>,
      },
      200,
    );
  });

  app.openapi(quotaRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    return c.json(await refreshQuota(ctx, c.req.valid('param').id), 200);
  });

  app.openapi(defaultRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const id = c.req.valid('param').id;
    if (!(await getProviderById(ctx, id))) throw new ApiError('not_found');
    await setDefaultProvider(ctx, id);
    return c.json({ ok: true }, 200);
  });

  app.openapi(listIdentitiesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    return c.json(await listProviderIdentities(ctx, c.req.valid('param').id), 200);
  });

  app.openapi(verifyIdentityRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const result = await verifyEmailIdentity(
      ctx,
      c.req.valid('param').id,
      c.req.valid('json').email,
    );
    return c.json(result, 200);
  });

  app.openapi(identityStatusRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const params = c.req.valid('param');
    // Adresa je v cestě, takže dorazí zakódovaná. Bez dekódování by se u Amazonu
    // hledala identita se znaky `%40` místo zavináče a odpověď by byla 404
    // u adresy, kterou uživatel prokazatelně má.
    return c.json(
      await emailIdentityStatus(ctx, params.id, decodeURIComponent(params.identity)),
      200,
    );
  });

  app.openapi(productionAccessRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const body = c.req.valid('json');
    const result = await requestProductionAccess(ctx, c.req.valid('param').id, {
      mail_type: body.mail_type,
      website_url: body.website_url,
      ...(body.additional_contact_emails === undefined
        ? {}
        : { additional_contact_emails: body.additional_contact_emails }),
      ...(body.contact_language === undefined ? {} : { contact_language: body.contact_language }),
    });
    return c.json(result, 200);
  });

  app.openapi(listDomainsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:read');
    const rows = await listDomains(ctx);
    return c.json({ data: rows as unknown as Array<Record<string, unknown>> }, 200);
  });

  app.openapi(createDomainRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:write');
    const body = c.req.valid('json');
    const row = await addDomain(ctx, { domain: body.domain, providerId: body.provider_id });
    const region = await providerRegion(ctx, row.provider_id);
    return c.json(
      { domain: row as unknown as Record<string, unknown>, records: domainRecords(row, region) },
      201,
    );
  });

  app.openapi(getDomainRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:read');
    const row = await getDomain(ctx, c.req.valid('param').id);
    if (!row) throw new ApiError('not_found');
    const region = await providerRegion(ctx, row.provider_id);
    return c.json(
      {
        domain: row as unknown as Record<string, unknown>,
        records: domainRecords(row, region),
        checks: (row.checks ?? {}) as Record<string, unknown>,
      },
      200,
    );
  });

  app.openapi(checkDomainRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:write');
    const id = c.req.valid('param').id;
    const since = await secondsSinceLastCheck(ctx, id);
    if (since !== null && since < DOMAIN_CHECK_MIN_INTERVAL_SECONDS) {
      // Obecný `rate_limited`, ne vlastní kód: klient s ním nakládá stejně.
      throw new ApiError('rate_limited', {
        retryAfter: DOMAIN_CHECK_MIN_INTERVAL_SECONDS - since,
        params: { retry_after: DOMAIN_CHECK_MIN_INTERVAL_SECONDS - since },
      });
    }
    const r = await checkDomainNow(ctx, id);
    const region = await providerRegion(ctx, r.domain.provider_id);
    return c.json(
      {
        domain: r.domain as unknown as Record<string, unknown>,
        records: domainRecords(r.domain, region),
        checks: r.checks as unknown as Record<string, unknown>,
      },
      200,
    );
  });

  app.openapi(mailFromRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:write');
    const row = await setMailFrom(ctx, c.req.valid('param').id, c.req.valid('json').subdomain);
    const region = await providerRegion(ctx, row.provider_id);
    return c.json(
      { domain: row as unknown as Record<string, unknown>, records: domainRecords(row, region) },
      200,
    );
  });

  app.openapi(deleteDomainRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'domains:write');
    const id = c.req.valid('param').id;
    if (!(await getDomain(ctx, id))) throw new ApiError('not_found');
    await deleteDomain(ctx, id);
    return c.body(null, 204);
  });

  app.openapi(getGuardsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:read');
    const settings = await readWorkspaceSettings(ctx);
    return c.json({ settings: settings.deliverability, limits: installationLimits() }, 200);
  });

  app.openapi(patchGuardsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'providers:write');
    const limits = installationLimits();

    /*
     * Hodnota z instalace je zároveň výchozí hodnota I STROP (část 4a, 3.15.2.1).
     * Přitvrdit jde, povolit ne, a odmítnutí je hlasité: `422 validation_failed`
     * s cestou na konkrétní klíč, nikdy tiché oříznutí. U podlahy `guard_min_sent`
     * znamená přísnější také nižší číslo, protože brzda pak zabere dřív.
     */
    const parsed = buildDeliverabilitySettingsSchema(limits).safeParse(c.req.valid('json'));
    if (!parsed.success) {
      throw new ApiError('validation_failed', {
        errors: parsed.error.issues.map((issue) => ({
          path: (issue.path ?? []).map((p) => String(p)).join('.'),
          code: issue.code ?? 'invalid_value',
          message: issue.message,
        })),
      });
    }

    await writeWorkspaceSettingsKey(ctx, 'deliverability', parsed.data);
    return c.json({ settings: parsed.data, limits }, 200);
  });
}
