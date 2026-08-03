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
import { registerBackupRoutes } from '@mlain/core/ops/api';
import { registerSegmentApiRoutes } from '@mlain/core/segments/api';
import { registerTemplateApiRoutes } from '@mlain/core/templates/api';
import { registerAssetApiRoutes } from '@mlain/core/assets/api';
import { registerCampaignApiRoutes } from '@mlain/core/campaigns/api';
import { registerProviderApiRoutes } from '@mlain/core/providers/api';
import { registerAiApiRoutes } from '@mlain/core/ai/api';
import { registerImportApiRoutes } from '@mlain/core/contacts/import/api';
import { registerExportApiRoutes } from '@mlain/core/contacts/export/api';
import { registerReportsRoutes } from '@mlain/core/reports/api';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { createApiApp, CONTENT_TYPE_EXEMPT_PREFIXES } from './app';
import { renderDocsHtml } from './docs';
import { buildPage, parsePaginationQuery } from './pagination';

/**
 * Dokument se IMPORTUJE, nehledá se na disku, a je to oprava dvou vad naráz.
 *
 * Dřív se zkoušely tři kandidátské cesty a brala se první existující. Vzniklo
 * to jako oprava plánu, který měl jediný a špatně spočítaný výraz, a fungovalo
 * to při vývoji. V produkci ale ne, ze dvou nezávislých důvodů:
 *
 * 1. `packages/contracts` se do image VŮBEC NEKOPÍRUJE. Runtime vrstva bere
 *    `.next/standalone`, `.next/static`, `public`, `worker/dist`, `cli/dist`
 *    a migrace. Žádný ze tří kandidátů by tedy neexistoval a `/api/v1/docs`
 *    i `/api/v1/openapi.json` by v běžící instalaci padaly. Že to nikdo
 *    nezjistil dřív, je tím, že se ty dvě trasy nikdy neprošly v kontejneru.
 *
 * 2. Hledání souboru za běhu shodilo analýzu závislostí Next.js, která nemá
 *    jak vědět, který kandidát platí. Stavba to hlásila jako „Encountered
 *    unexpected file in NFT list" se stopou přes tenhle soubor a vystopovala
 *    kvůli tomu celý projekt, čímž zbytečně nafoukla image.
 *
 * Statický import obojí ruší: dokument je součástí svazku, takže existuje vždy
 * a nikde se nehledá. Zůstává vlastnost, kvůli které se to čtení ze souboru
 * zavádělo, tedy že se servíruje TENTÝŽ commitnutý dokument jako v repozitáři,
 * ne dokument generovaný za běhu.
 *
 * CESTA JE RELATIVNÍ, NE PŘES JMÉNO BALÍČKU, a je to vynucené, ne z pohodlí.
 * Turbopack podcestu `@mlain/contracts/openapi.json` nerozřeší ani tehdy, když
 * ji `exports` mapa vystavuje. Ověřeno spuštěním: s klíčem v mapě, po `pnpm
 * install` i po restartu serveru vracelo CELÉ `/api/v1` pětistovku s hláškou
 * `Module not found: Can't resolve '@mlain/contracts/openapi.json'`. Nezáleželo
 * na tom, jestli je u importu atribut `with { type: 'json' }`.
 *
 * Klíč v `exports` mapě contracts přesto zůstává: platí pro Node i pro vitest
 * a je správně. Jen se na něj tady nedá spolehnout.
 *
 * `turbopack.root` v `next.config.ts` ukazuje na kořen workspace, takže tahle
 * cesta drží i v produkčním sestavení.
 */
import openapiDocument from '../../../../../packages/contracts/openapi.json';

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
  // Import a export kontaktů (P11) se registrují PŘED doménou kontaktů, a to
  // je podstatné, ne kosmetické.
  //
  // Hono zkouší cesty v pořadí registrace. `registerContactsRoutes` definuje
  // `/contacts/{id}`, což je vzor, na který sedí i `/contacts/imports`: slovo
  // `imports` se matchne jako identifikátor kontaktu. Seznam importů pak vrací
  //
  //   422 invalid_uuid   (na parametru `id`)
  //
  // tedy hlášku o neplatném UUID nad cestou, kde žádné UUID není. Hledá se to
  // mizerně, protože obě cesty jsou správně definované a chyba je jen v pořadí.
  //
  // Pravidlo: konkrétnější cesta se registruje dřív než ta s parametrem.
  registerImportApiRoutes(app);
  registerExportApiRoutes(app);
  // Doména kontaktů (P07). Router si skládá `packages/core/src/contacts/api/index.ts`
  // a tady se jen mountuje pod /api/v1, protože packages/core nesmí importovat z apps/web.
  registerContactsRoutes(app);
  // Onboarding a ukázková data (P16). Týž vzor jako u kontaktů: definice cest
  // leží v packages/core, mount je tady.
  registerOnboardingRoutes(app);
  registerDemoDataRoutes(app);
  // Zálohy: registruje se ČTENÍ SEZNAMU a SPUŠTĚNÍ, nikdy ne ověřování.
  //
  // Tenhle řádek tu třikrát byl a třikrát shodil CELOU aplikaci na 500, ne jen
  // zálohy. `ops/api/backups.routes.ts` tehdy táhl přes `backup-verify.ts`
  // migrační runner, a ten si skládá cestu k adresáři s migracemi výrazem,
  // který bundler neumí přeložit. Nepomohl ani dynamický import, ani vytažení
  // výrazu do funkce; bundler prochází i dynamické importy. Hledalo se to
  // mizerně, protože obrazovky spadly agentovi, který na zálohy vůbec nesáhl.
  // Viz nálezy I19 a I33.
  //
  // Registrace je bezpečná teprve od chvíle, kdy `backups.routes.ts` endpoint
  // pro ověření zálohy NEMÁ a `backup-verify.ts` tedy neimportuje ani nepřímo.
  // Je to zapsané i v tom souboru: ověřování zálohy zakládá dočasnou databázi,
  // nahraje celý dump a přehraje migrace, což u reálné instalace trvá minuty.
  // Držet na tom otevřený HTTP požadavek je špatný tvar bez ohledu na bundlery,
  // takže ověřování patří do `mlain backup verify` a do týdenní úlohy.
  //
  // Kdo sem bude přidávat další cestu k zálohám: napřed se ujisti, že nová
  // závislost nevede na `backup-verify.ts` ani na `@mlain/db/migrate`. Selže
  // to celou aplikací, ne tou jednou cestou.
  registerBackupRoutes(app);
  // Doména segmentů (P11). Stejný tvar jako u kontaktů: router si skládá
  // `packages/core/src/segments/api/index.ts`, tady se jen mountuje pod /api/v1.
  registerSegmentApiRoutes(app);
  // Doména šablon (P08). Bez ní se v produktu na rozesílání e-mailů nedá
  // vytvořit šablona: doména `packages/core/src/templates` byla hotová
  // a otestovaná, ale trasy k ní neexistovaly, takže `POST /api/v1/templates`
  // vracelo 404 a zlatá cesta padala na kroku „vytvoření šablony".
  //
  // Pořadí uvnitř domény hlídá `templates.routes.ts`: `/templates/field-usage`
  // se registruje PŘED `/templates/{id}`, jinak by ho vzor parametru pohltil.
  registerTemplateApiRoutes(app);
  // Doména assetů (P08, kapitola 3.14). Bez ní jsou v editoru šablon mrtvé dvě
  // z devíti operací, „nahrát obrázek" a „vypsat knihovnu", protože porty
  // `apps/web/src/features/editor/ports/http-ports.ts` volají `/assets`
  // a `POST /assets`, které do teď neexistovaly.
  //
  // Pořadí uvnitř domény: `GET /assets` se registruje před `GET /assets/{id}`,
  // takže se žádná konkrétní cesta o vzor s parametrem neotře. Kdo sem bude
  // přidávat `/assets/<neco>`, musí to zaregistrovat PŘED `/assets/{id}`.
  //
  // Veřejný výdej souboru tady NENÍ a být nemá: `<ASSET_BASE_URL>/a/{public_id}/
  // {variant}.{ext}` nestojí pod `/api/v1`, protože ho otevírá poštovní klient
  // příjemce bez přihlášení. Obsluhuje ho trasa Next.js
  // `apps/web/src/app/a/[[...path]]/route.ts`, stejným vzorem jako `/t/**`.
  registerAssetApiRoutes(app);
  // Doména kampaní a nastavení odesílání (P13). Týž tvar jako u kontaktů a segmentů:
  // definice cest leží v packages/core, mount je tady.
  registerCampaignApiRoutes(app);
  registerProviderApiRoutes(app);
  // Doména AI (P15). Týž tvar jako u kontaktů a segmentů: definice cest
  // i handlery leží v `packages/core/src/ai/api/index.ts`, tady jen mount.
  registerAiApiRoutes(app);
  // Doména reportů (P14). Pět čtecích cest: souhrn kampaně, průběh v čase,
  // odkazy, příjemci, živý proud a časová osa kontaktu s přehledem projektu.
  registerReportsRoutes(app);
  // Nahrání souboru je JEDINÉ místo v /api/v1, které neposílá application/json:
  // tělo je surový proud (nebo multipart), aby server nikdy nedržel 200 MB
  // v paměti. Bez téhle výjimky by výchozí kontrola typu vrátila 415.
  CONTENT_TYPE_EXEMPT_PREFIXES.add('/api/v1/contacts/imports');
  // Nahrání obrázku je `multipart/form-data` a smí mít až ASSET_MAX_UPLOAD_MB
  // (výchozí 10 MiB), tedy víc než výchozí strop 1 MiB na tělo JSON. Skutečný
  // limit hlídá `uploadAsset` podle konfigurace a vrací `payload_too_large`
  // s vysvětlením; bez téhle výjimky by ho ale předběhl obecný middleware
  // a odmítl každý obrázek nad 1 MiB, tedy skoro každou fotku.
  CONTENT_TYPE_EXEMPT_PREFIXES.add('/api/v1/assets');

  // 4.7: endpoint servíruje TEN SAMÝ commitnutý soubor, ne dokument generovaný
  // za běhu, aby se produkce chovala stejně jako repozitář.
  app.get('/api/v1/openapi.json', () => {
    // Serializace musí dát BAJT PO BAJTU tentýž obsah jako soubor
    // v repozitáři, protože to hlídá test kontraktu. Odsazení dvěma mezerami
    // a koncový nový řádek odpovídají tomu, jak dokument zapisuje generátor.
    // Prosté `JSON.stringify(doc)` shodu rozbije a projeví se to až tím testem,
    // ne ničím v prohlížeči.
    return new Response(`${JSON.stringify(openapiDocument, null, 2)}\n`, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  app.get('/api/v1/docs', (c) => {
    return c.html(renderDocsHtml(openapiDocument as OpenApiDocument));
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
      { name: 'Templates' },
      { name: 'Campaigns' },
      { name: 'Sending' },
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
