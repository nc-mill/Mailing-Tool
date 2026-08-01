import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { registerSetupRoutes } from '@mlain/core/identity/api/setup.routes';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWorkspaceRoutes } from '@mlain/core/identity/api/workspaces.routes';
import { registerMemberRoutes } from '@mlain/core/identity/api/members.routes';
import { registerInvitationRoutes } from '@mlain/core/identity/api/invitations.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { registerWebhookEndpointRoutes } from '@mlain/core/platform/api/webhooks.routes';
import { registerAuditRoutes, setPaginationDeps } from '@mlain/core/platform/api/audit.routes';
import { registerJobRoutes } from '@mlain/core/platform/api/jobs.routes';
import { registerContactsRoutes } from '@mlain/core/contacts/api';
import { registerOnboardingRoutes } from '@mlain/core/onboarding/api';
import { registerDemoDataRoutes } from '@mlain/core/demo/api';
import { registerSegmentApiRoutes } from '@mlain/core/segments/api';
import { registerImportApiRoutes } from '@mlain/core/contacts/import/api';
import { registerExportApiRoutes } from '@mlain/core/contacts/export/api';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { createApiApp, CONTENT_TYPE_EXEMPT_PREFIXES } from './app';
import { renderDocsHtml } from './docs';
import { buildPage, parsePaginationQuery } from './pagination';

/**
 * ODCHYLKA OD PLÁNU: cesta ke commitnutému dokumentu se hledá, nepočítá.
 *
 * Plán měl jediný výraz `new URL('../../../../packages/contracts/openapi.json',
 * import.meta.url)`. Ten je špatně o jednu úroveň (z `apps/web/src/lib/api`
 * vede na `apps/packages/...`) a navíc stojí na tom, že `import.meta.url`
 * ukazuje do zdrojového stromu. To v bundlu Next.js neplatí, viz stejný nález
 * u `EXPECTED_SCHEMA_VERSION` v `src/runtime.ts`. Zkoušejí se proto tři
 * kandidáti a bere se první existující; když neexistuje ani jeden, chyba to
 * řekne nahlas i s tím, co se hledalo.
 */
const OPENAPI_CANDIDATES = [
  fileURLToPath(new URL('../../../../../packages/contracts/openapi.json', import.meta.url)),
  resolve(process.cwd(), '../../packages/contracts/openapi.json'),
  resolve(process.cwd(), 'packages/contracts/openapi.json'),
];

let openapiPath: string | null = null;

export function openapiFilePath(): string {
  if (openapiPath) return openapiPath;
  const found = OPENAPI_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `packages/contracts/openapi.json nenalezen. Hledáno: ${OPENAPI_CANDIDATES.join(', ')}. ` +
        'Spusť pnpm --filter @mlain/web generate:openapi.',
    );
  }
  openapiPath = found;
  return found;
}

/**
 * Jediné místo, kde se skládá celá aplikace. Používá ho runtime (route.ts),
 * generátor i testy, takže se nemůže stát, že by generátor viděl jiné cesty
 * než produkce.
 */
export function buildApp(): OpenAPIHono<ApiEnv> {
  const app = createApiApp();

  // Stránkovací pomocníky bydlí v apps/web, definice cest v packages/core.
  // Injektáž je jediný způsob, jak je propojit, aniž by core importoval z web.
  setPaginationDeps({ parseQuery: parsePaginationQuery, buildPage });

  registerSetupRoutes(app);
  registerAuthRoutes(app);
  registerWorkspaceRoutes(app);
  registerMemberRoutes(app);
  registerInvitationRoutes(app);
  registerApiKeyRoutes(app);
  registerWebhookEndpointRoutes(app);
  registerAuditRoutes(app);
  registerJobRoutes(app);
  // Doména kontaktů (P07). Router si skládá `packages/core/src/contacts/api/index.ts`
  // a tady se jen mountuje pod /api/v1, protože packages/core nesmí importovat z apps/web.
  registerContactsRoutes(app);
  // Onboarding a ukázková data (P16). Týž vzor jako u kontaktů: definice cest
  // leží v packages/core, mount je tady.
  registerOnboardingRoutes(app);
  registerDemoDataRoutes(app);
  // Doména segmentů (P11). Stejný tvar jako u kontaktů: router si skládá
  // `packages/core/src/segments/api/index.ts`, tady se jen mountuje pod /api/v1.
  registerSegmentApiRoutes(app);
  // Import a export kontaktů (P11).
  registerImportApiRoutes(app);
  registerExportApiRoutes(app);
  // Nahrání souboru je JEDINÉ místo v /api/v1, které neposílá application/json:
  // tělo je surový proud (nebo multipart), aby server nikdy nedržel 200 MB
  // v paměti. Bez téhle výjimky by výchozí kontrola typu vrátila 415.
  CONTENT_TYPE_EXEMPT_PREFIXES.add('/api/v1/contacts/imports');

  // 4.7: endpoint servíruje TEN SAMÝ commitnutý soubor, ne dokument generovaný
  // za běhu, aby se produkce chovala stejně jako repozitář.
  app.get('/api/v1/openapi.json', () => {
    const body = readFileSync(openapiFilePath(), 'utf8');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  app.get('/api/v1/docs', (c) => {
    const document = JSON.parse(readFileSync(openapiFilePath(), 'utf8')) as OpenApiDocument;
    return c.html(renderDocsHtml(document));
  });

  return app;
}

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
};

export function buildOpenApiDocument(app: OpenAPIHono<ApiEnv>): OpenApiDocument {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Mlain Mailer API',
      version: 'v1',
      description:
        'Veřejné REST API. Klient se rozhoduje podle pole `code` v chybové odpovědi, ne podle `type` ani `title`. Neznámé hodnoty ve výčtech musí tolerovat.',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Setup' },
      { name: 'Auth' },
      { name: 'Workspaces' },
      { name: 'Members' },
      { name: 'Invitations' },
      { name: 'API keys' },
      { name: 'Webhooks' },
      { name: 'Audit' },
      { name: 'Contacts' },
      { name: 'Contact fields' },
      { name: 'Tags' },
      { name: 'Lists' },
      { name: 'Suppressions' },
      { name: 'Consents' },
      { name: 'GDPR' },
      { name: 'Retention' },
      { name: 'Vocative review' },
      { name: 'Name overrides' },
    ],
  }) as OpenApiDocument;
}

/** Cesty registrované v routeru, bez testovacích a bez duplicit. */
export function registeredPaths(app: OpenAPIHono<ApiEnv>): string[] {
  const paths = new Set<string>();
  for (const route of app.routes) {
    if (!route.path.startsWith('/api/v1')) continue;
    if (route.path.includes('__test')) continue;
    if (route.path.includes('*')) continue;
    // Hono používá :param, OpenAPI {param}. Dvojtečka se ale převádí JEN
    // na začátku segmentu, tedy hned za lomítkem.
    //
    // Bez té podmínky se převedla i dvojtečka uprostřed segmentu, kterou
    // doména kontaktů používá jako příponu akce podle vzoru vlastních metod
    // (`/contacts/tags:bulk`, `/lists/{id}/subscribe:bulk`). Vznikly z toho
    // cesty `/contacts/tags{bulk}`, tedy něco, co není ani platná cesta,
    // ani parametr, a kontrola „každá registrovaná cesta je v dokumentu"
    // je hlásila jako chybějící v OpenAPI. Vada přitom nebyla v routách.
    paths.add(route.path.replace(/(^|\/):([A-Za-z_]+)/g, '$1{$2}'));
  }
  return [...paths];
}
