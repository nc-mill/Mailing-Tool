import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { getFieldCatalog } from '../../contacts/fields/catalog';
import { ApiError } from '../../errors/api-error';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { withWorkspace } from '../../tx';
import { DEMO_CONTACTS } from '../dataset';
import { purgeDemoData } from '../purge';
import { DemoAlreadySeededError, readDemoManifest, readDemoTagId, seedDemoData } from '../seed';

const TAG = 'Demo data';

const CountsSchema = z
  .object({
    contacts: z.number().int().nonnegative(),
    lists: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
    segments: z.number().int().nonnegative(),
    templates: z.number().int().nonnegative(),
    campaigns: z.number().int().nonnegative(),
  })
  .openapi('DemoDataCounts');

const StateSchema = z
  .object({
    present: z.boolean(),
    counts: CountsSchema.nullable(),
    /** Štítek pro hromadný výběr v tabulce kontaktů, která filtruje podle `tag_id`. */
    tagId: z.string().nullable(),
  })
  .openapi('DemoDataState');

const stateRoute = createRoute({
  method: 'get',
  path: '/api/v1/demo-data',
  tags: [TAG],
  summary: 'Zjistí, jestli jsou v projektu ukázková data',
  security: [{ bearerAuth: ['contacts:read'] }],
  responses: {
    200: {
      description: 'Přítomnost ukázkových dat a počty položek',
      content: { 'application/json': { schema: z.object({ data: StateSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const seedRoute = createRoute({
  method: 'post',
  path: '/api/v1/demo-data',
  tags: [TAG],
  summary: 'Nahraje do projektu ukázková data',
  security: [{ bearerAuth: ['contacts:write'] }],
  // Prázdné tělo je tu schválně. Sada nemá co nastavovat, ale kostra aplikace
  // vyžaduje u zápisů `Content-Type: application/json`; ověřeno spuštěním
  // proti běžícímu serveru, kde POST bez hlavičky skončil na 415. Deklarované
  // tělo zajistí, že vygenerovaný klient hlavičku pošle.
  request: {
    body: {
      required: false,
      content: {
        'application/json': { schema: z.object({}).strict().openapi('DemoDataSeedInput') },
      },
    },
  },
  responses: {
    201: {
      description: 'Ukázková data nahrána',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ contacts: z.number().int() }) }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('already_exists'),
    415: problemResponse('unsupported_media_type'),
  },
});

const purgeRoute = createRoute({
  method: 'delete',
  path: '/api/v1/demo-data',
  tags: [TAG],
  summary: 'Odstraní z projektu ukázková data podle manifestu',
  security: [{ bearerAuth: ['contacts:delete'] }],
  responses: {
    200: {
      description: 'Počty smazaných položek',
      content: { 'application/json': { schema: z.object({ data: CountsSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM: viz komentář v `onboarding.routes.ts`.
 * Veřejné API je jeden Hono router v `packages/core`, ne soubory route.ts
 * v App Routeru, a `defineRoute` v repozitáři neexistuje.
 */
export function registerDemoDataRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(stateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const { manifest, tagId } = await withWorkspace(ctx, async (tx) => ({
      manifest: await readDemoManifest(tx, ctx.workspaceId),
      tagId: await readDemoTagId(tx, ctx.workspaceId),
    }));
    if (manifest === null) {
      return c.json({ data: { present: false, counts: null, tagId: null } }, 200);
    }
    return c.json(
      {
        data: {
          present: true,
          tagId,
          counts: {
            contacts: manifest.contactIds.length,
            lists: manifest.listIds.length,
            tags: manifest.tagIds.length,
            segments: manifest.segmentIds.length,
            templates: manifest.templateIds.length,
            campaigns: manifest.campaignIds.length,
          },
        },
      },
      200,
    );
  });

  app.openapi(seedRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    // Katalog polí se vyzvedává PŘED transakcí. Uvnitř by si otevřel druhé
    // spojení z poolu, zatímco to první drží zámek nad řádkem projektu.
    // Seed ho potřebuje na ověření ukázkových šablon.
    const fields = await getFieldCatalog(ctx);
    try {
      // Celý seed uvnitř JEDNÉ transakce s kontextem projektu. Bez obálky by
      // první INSERT skončil na WITH CHECK politiky ws_isolation.
      const manifest = await withWorkspace(ctx, (tx) =>
        seedDemoData(tx, { workspaceId: ctx.workspaceId, now: new Date(), fields }),
      );
      return c.json({ data: { contacts: manifest.contactIds.length } }, 201);
    } catch (err) {
      if (err instanceof DemoAlreadySeededError) {
        // `ApiError` nese jen strojové parametry, text hlášky se skládá
        // z katalogu podle Accept-Language. Počet kontaktů proto jde ven
        // jako parametr, ne jako věta.
        throw new ApiError('already_exists', {
          params: { contacts: DEMO_CONTACTS.length },
          cause: err,
        });
      }
      throw err;
    }
  });

  app.openapi(purgeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:delete');
    const report = await withWorkspace(ctx, (tx) =>
      purgeDemoData(tx, { workspaceId: ctx.workspaceId }),
    );
    return c.json({ data: report.deleted }, 200);
  });
}
