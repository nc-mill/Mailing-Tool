import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { createHtmlEngine, createTextEngine } from '@mlain/contracts/liquid/engine';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import type { CompileMeta } from '@mlain/emails/compile/types';
import type { Document } from '@mlain/emails/document/types';
import type { Issue } from '@mlain/emails/issue';
import { toPreparedSchema } from '@mlain/emails/paths';
import { loadConfig, type MlainConfig } from '../../config';
import { ApiError } from '../../errors/api-error';
import { resolveDetail } from '../../errors/detail-catalog';
import { getFieldCatalog, type FieldCatalog } from '../../contacts/fields/catalog';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { pgErrorCode, withWorkspace, type Tx } from '../../tx';
import { assetIdsInDocument, loadAssetRefs } from '../assets';
import { compileTemplate } from '../compile';
import { isListEmailTemplate } from '../../contacts/lists/list-email-guards';
import { preSendCheck } from '../precheck';
import {
  categoryOf,
  countTemplatesByCategory,
  EMPTY_TEMPLATE_USAGE,
  findTemplateById,
  findTemplateIdsUsingField,
  listTemplates,
  listTemplateSummaries,
  loadTemplateUsage,
  validationProfileFor,
  type TemplateSummaryRow,
  type TemplateKind,
  type TemplateRow,
  type TemplateUsage,
} from '../repository';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  renameTemplate,
  restoreTemplate,
  restoreTemplateVersion,
  saveDesign,
  type ServiceContext,
} from '../service';
import { sendTemplateTest, TestSendError, TEST_SEND_MAX_RECIPIENTS } from '../test-send';
import { validateTemplateDocument } from '../validate';
import { createVersion, listVersions, type VersionRow } from '../versions';
import { contactPreviewData, samplePreviewData, type PreviewDataInput } from './preview-data';
import {
  CompileRequest,
  CompileResponse,
  CreateTemplateRequest,
  CreateVersionRequest,
  FieldUsageResponse,
  PatchTemplateRequest,
  PreviewRequest,
  PreviewResponse,
  TemplateCategorySchema,
  TemplateKindSchema,
  TemplateListResponse,
  type TemplateSummary,
  TemplateResponse,
  TestSendRequest,
  TestSendResponse,
  ValidateResponse,
  VersionItem,
  VersionListResponse,
  Uuid,
} from './schemas';
import type { TemplatesEnv } from './index';

const TAG = 'Templates';

const IdParam = z.object({ id: Uuid });

/**
 * Konfigurace se čte líně a memoizovaně, stejně jako v `identity/session.ts`.
 * `loadConfig()` hází `ConfigError`, když chybí proměnná prostředí, takže volání
 * při importu modulu by shodilo i cesty, které konfiguraci nepotřebují.
 */
let cachedConfig: MlainConfig | null = null;
function config(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/** Jazyk náhledu a kompilace bere dokument, ne požadavek: je to vlastnost šablony. */
function languageOf(design: unknown): string {
  const meta = (design as { meta?: { language?: unknown } } | null)?.meta;
  return typeof meta?.language === 'string' && meta.language !== ''
    ? meta.language
    : config().DEFAULT_LOCALE;
}

/** Vzorová data existují jen v češtině a angličtině; ostatní jazyky padají na angličtinu. */
function sampleLanguage(language: string): 'cs' | 'en' {
  return language.split('-')[0] === 'cs' ? 'cs' : 'en';
}

function present(row: TemplateRow): z.infer<typeof TemplateResponse> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    schema_version: row.schemaVersion,
    design: row.design as Record<string, unknown>,
    design_hash: row.designHash.toString('hex'),
    validation_state: row.validationState,
    validation_errors: (row.validationErrors ?? []) as z.infer<
      typeof TemplateResponse
    >['validation_errors'],
    // Sloupec plní `createVersion`. Natvrdo null by zahodilo hodnotu, kterou
    // databáze má, a klient by nepoznal, na které verzi stojí.
    current_version_id: row.currentVersionId,
    used_fields: row.usedFields,
    // Náhled šablony nikdo nenastavuje, dokud nevznikne doména assetů
    // (P08, kapitola 40). Hodnota je zatím vždy null a je to vědomé.
    thumbnail_asset_id: row.thumbnailAssetId,
    starter: row.starter,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Úsporná položka seznamu. Sloupec `design` se sem nedostane ani omylem.
 *
 * `category` a `usage` jsou JEN tady, ne v plné odpovědi `TemplateResponse`,
 * a je to rozhodnutí o ceně. Obojí stojí dotaz navíc, plnou odpověď vrací
 * i `PATCH /templates/{id}`, a ten volá autosave editoru každých pět sekund.
 * Byl by to dotaz na data, která editor nepoužije. Knihovna je jediná
 * obrazovka, která kategorii i zapojení potřebuje, a ta čte právě seznam.
 */
function presentSummary(
  row: TemplateSummaryRow,
  usage: TemplateUsage,
): z.infer<typeof TemplateSummary> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    category: categoryOf(row.kind, usage),
    usage,
    validation_state: row.validationState,
    starter: row.starter,
    updated_at: row.updatedAt.toISOString(),
  };
}

function presentVersion(row: VersionRow): z.infer<typeof VersionItem> {
  return {
    id: row.id,
    version: row.version,
    label: row.label,
    reason: row.reason,
    pinned: row.pinned,
    design_hash: row.designHash.toString('hex'),
    created_at: row.createdAt.toISOString(),
  };
}

async function serviceContext(ctx: WorkspaceContext): Promise<ServiceContext> {
  return {
    ctx,
    fields: await getFieldCatalog(ctx),
    ...(ctx.actor.type === 'user' ? { userId: ctx.actor.userId } : {}),
  };
}

async function load(tx: Tx, ctx: WorkspaceContext, id: string): Promise<TemplateRow> {
  const row = await findTemplateById(tx, ctx, id);
  if (!row) throw new ApiError('not_found');
  return row;
}

/**
 * Doménové chyby chodí jako `Error` s kódem ve zprávě, chyby databáze jako
 * `DrizzleQueryError` se SQLSTATE na `error.cause.code`. Obojí musí skončit
 * jako 4xx, jinak uživatel dostane 500 za něco, co udělal sám: přepsal cizí
 * verzi, poslal nesmyslný hash nebo zadal jméno, které už je zabrané.
 *
 * `pgErrorCode` prochází řetěz `cause`. Kdo by testoval `error.code` přímo,
 * testoval by `undefined` a tahle větev by se NIKDY neprovedla; kolize jména
 * při zakládání šablony by pak byla pětistovka. Ověřeno spuštěním, ne odvozeno:
 * bez téhle větve padal test „kolize jména je 409, ne 500" právě takhle.
 */
function translateDomainError(error: unknown): never {
  const sqlstate = pgErrorCode(error);
  if (sqlstate === '23505') throw new ApiError('template_name_conflict');
  if (sqlstate === '23514') {
    throw new ApiError('validation_failed', {
      errors: [{ path: '', code: 'invalid_value', message: 'Šablona porušuje omezení databáze.' }],
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case 'not_found':
      throw new ApiError('not_found');
    case 'precondition_failed':
      throw new ApiError('precondition_failed');
    case 'precondition_malformed':
      // 412 by znamenalo „změnil to někdo jiný", což je nepravda: klient poslal
      // nesmysl a musí se to dozvědět.
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: 'if_design_hash',
            code: 'invalid_value',
            message: '`if_design_hash` musí mít 64 znaků [0-9a-f].',
          },
        ],
      });
    case 'template_name_conflict':
      throw new ApiError('template_name_conflict');
    // Jméno ze samých mezer. Není to konflikt ani chybějící pole, je to
    // hodnota, kterou po ořezání nezbylo co uložit, a patří k poli `name`,
    // aby ji rozhraní ukázalo u něj, ne jako obecnou hlášku nahoře.
    case 'template_name_empty':
      throw new ApiError('validation_failed', {
        errors: [
          { path: 'name', code: 'required_field_missing', message: 'Název nesmí být prázdný.' },
        ],
      });
    case 'template_starter_immutable':
      throw new ApiError('template_starter_immutable');
    case 'template_in_use':
      throw new ApiError('template_in_use');
    default:
      throw error;
  }
}

/**
 * Chyby testovacího odeslání. `TestSendError` nese kód a strojově čitelné
 * parametry, tady se z nich skládá odpověď podle registru.
 *
 * Čtyři z těch kódů registr nemá a mít nemá: `test_recipients_out_of_range`,
 * `test_recipient_invalid`, `test_no_contact` a `test_sending_not_configured`
 * jsou důvody JEDNOHO stavu 422 `validation_failed`, ne samostatné kořenové
 * kódy. Rozlišuje je pole `errors`, které klient dostane a umí zobrazit.
 */
function translateTestSendError(error: unknown): never {
  if (!(error instanceof TestSendError)) return translateDomainError(error);
  const params = error.params ?? {};
  switch (error.message) {
    case 'test_rate_limited':
      throw new ApiError('test_rate_limited', { params });
    case 'test_recipient_suppressed':
      throw new ApiError('test_recipient_suppressed', { params });
    case 'test_template_not_compilable':
      throw new ApiError('template_document_invalid', {
        findings: findingsOf((params['issues'] as Issue[]) ?? []),
      });
    case 'test_recipients_out_of_range':
      throw new ApiError('validation_failed', {
        params,
        errors: [
          {
            path: 'recipients',
            code: 'out_of_range',
            message: `Testovací odeslání přijímá 1 až ${TEST_SEND_MAX_RECIPIENTS} adres.`,
          },
        ],
      });
    case 'test_recipient_invalid':
      throw new ApiError('validation_failed', {
        params,
        errors: [
          { path: 'recipients', code: 'invalid_value', message: 'Neplatná e-mailová adresa.' },
        ],
      });
    case 'test_no_contact':
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: '',
            code: 'test_no_contact',
            message:
              'Projekt nemá žádný kontakt, ze kterého by šla vzít data pro dosazení. Nahrajte kontakty a zkuste to znovu.',
          },
        ],
      });
    // Prázdná šablona, tedy dokument bez jediného obsahového bloku. Patří sem,
    // mezi důvody jednoho 422, a ne mezi kořenové kódy: je to stejný druh
    // nedodělané práce jako projekt bez kontaktu, ne vlastní stav odesílání.
    case 'test_template_empty':
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: '',
            code: 'test_template_empty',
            message:
              'E-mail je zatím prázdný: kromě patičky v něm není žádný obsah. Napište do něj text, obrázek nebo tlačítko a zkuste to znovu.',
          },
        ],
      });
    case 'test_sending_not_configured':
      throw new ApiError('validation_failed', {
        errors: [
          {
            path: '',
            code: 'test_sending_not_configured',
            // Hláška radila „nejdřív založte kampaň", což bylo od 7. 8. 2026
            // špatné doporučení: odesílatel se od té doby bere i z připojeného
            // účtu s ověřenou adresou, tedy z kroku, který panel prvních kroků
            // nabízí DŘÍV než kampaň. Posílat uživatele zpátky na kampaň by
            // znamenalo poslat ho oklikou, kterou už nepotřebuje.
            message:
              'Projekt nemá nastavené odesílání. Připojte odesílací účet a ověřte adresu odesílatele v Nastavení → Odesílání.',
          },
        ],
      });
    default:
      throw error;
  }
}

function findingsOf(issues: readonly Issue[]): Array<{
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  params?: Record<string, unknown>;
}> {
  return issues.map((issue) => ({
    code: issue.code,
    // Obálka chyb zná jen `error` a `warning`; `info` na dokumentu je nález,
    // ne chyba, a do těla problému se stejně dostane jen u blokujících.
    severity: issue.severity === 'error' ? ('error' as const) : ('warning' as const),
    message: resolveDetail(issue.code, config().DEFAULT_LOCALE),
    ...(issue.pointer === '' ? {} : { path: issue.path ?? issue.pointer }),
    ...(issue.params === undefined ? {} : { params: issue.params }),
  }));
}

/**
 * Dokument se ověřuje PŘED zápisem, ne až po něm.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. P08 (Task 42) volal `createTemplate` rovnou
 * a teprve z uloženého řádku četl `validation_state`, takže po odmítnutém
 * dokumentu zůstala v databázi neplatná šablona a uživatel ji viděl v seznamu.
 * Druhý důvod je tvrdší: `createTemplate` počítá `used_fields` průchodem
 * dokumentu JEŠTĚ PŘED validací, takže na dokumentu, který není ani platný
 * podle JSON Schema, spadne dřív, než se ke stavu vůbec dojde, a uživatel
 * dostane 500 místo 422. Stavové kódy i tvar odpovědi zůstávají z plánu.
 */
async function requireValidDocument(
  ctx: WorkspaceContext,
  fields: FieldCatalog,
  kind: TemplateKind,
  raw: unknown,
): Promise<Document> {
  // Odkaz, který není UUID, se do dotazu nepustí: Postgres by na něm skončil
  // chybou 22P02 a z uživatelovy chyby v dokumentu by byla pětistovka.
  // Sémantická kontrola ho pak ohlásí jako neznámý asset, což je pravda.
  const assetIds = assetIdsInDocument(raw).filter((id) => Uuid.safeParse(id).success);
  const assets = await withWorkspace(ctx, (tx) => loadAssetRefs(tx, ctx, assetIds));
  const result = validateTemplateDocument(raw, {
    // Profil, ne `kind`: pracovní obsah kampaně se kontroluje jako kampaň.
    templateKind: validationProfileFor(kind),
    fields,
    assetIds: new Set(Object.keys(assets)),
  });
  if (result.state === 'valid' && result.document) return result.document;

  const blocking = result.issues.filter((issue) => issue.severity === 'error');
  const findings = findingsOf(blocking);
  if (blocking.some((issue) => issue.code === 'content_too_many_blocks')) {
    throw new ApiError('content_too_many_blocks', { findings });
  }
  if (blocking.some((issue) => issue.code === 'template_schema_too_new')) {
    throw new ApiError('template_schema_too_new', { findings });
  }
  throw new ApiError('template_document_invalid', { findings });
}

/** Kompilace pro náhled a kontrolu. Nikdy nic neukládá. */
async function compileFor(
  tx: Tx,
  ctx: WorkspaceContext,
  row: TemplateRow,
  fields: FieldCatalog,
  campaignId?: string,
) {
  const design = row.design as Document;
  return compileTemplate({
    tx,
    ctx,
    document: design,
    templateKind: validationProfileFor(row.kind),
    fields,
    language: languageOf(design),
    assetBaseUrl: config().ASSET_BASE_URL,
    purpose: 'preview',
    ...(campaignId === undefined ? {} : { campaignId }),
    trackOpens: false,
    trackClicks: false,
    preheader: design.meta.previewText,
  });
}

/* ------------------------------------------------------------------------ *
 * Definice cest
 * ------------------------------------------------------------------------ */

const listRoute = createRoute({
  method: 'get',
  path: '/templates',
  tags: [TAG],
  summary: 'Šablony projektu',
  security: [{ bearerAuth: ['templates:read'] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().min(1).optional(),
      kind: TemplateKindSchema.optional(),
      /**
       * Filtr knihovny. Bez něj se vrací všechny kategorie, což je stav „Vše";
       * samostatná hodnota `all` by byla druhý způsob, jak říct totéž.
       */
      category: TemplateCategorySchema.optional(),
      validation_state: z.enum(['unknown', 'valid', 'invalid']).optional(),
      /**
       * Tvar položek. Výchozí `full` je to, co cesta vracela vždycky, takže
       * stávající volající se nedotkne. `summary` vynechá dokument `design`,
       * což je zdaleka největší sloupec tabulky a do výběru šablony k ničemu.
       */
      view: z.enum(['full', 'summary']).default('full'),
    }),
  },
  responses: {
    200: {
      description: 'Stránka šablon',
      content: { 'application/json': { schema: TemplateListResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

/*
 * POZOR NA POŘADÍ: `/templates/field-usage` je registrovaná PŘED
 * `/templates/{id}`. Hono zkouší cesty v pořadí registrace, takže by slovo
 * `field-usage` jinak sedlo na vzor `{id}` a dopadová analýza by vracela
 * 422 o neplatném UUID nad cestou, kde žádné UUID není. Týž důvod je popsaný
 * u importů kontaktů v `apps/web/src/lib/api/openapi.ts`.
 */
const fieldUsageRoute = createRoute({
  method: 'get',
  path: '/templates/field-usage',
  tags: [TAG],
  summary: 'Šablony, které používají dané kontaktní pole',
  security: [{ bearerAuth: ['templates:read'] }],
  request: { query: z.object({ field: z.string().min(1).max(200) }) },
  responses: {
    200: {
      description: 'Šablony s tímhle polem',
      content: { 'application/json': { schema: FieldUsageResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const createTemplateRoute = createRoute({
  method: 'post',
  path: '/templates',
  tags: [TAG],
  summary: 'Nová šablona',
  security: [{ bearerAuth: ['templates:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateTemplateRequest } } } },
  responses: {
    201: { description: 'Založeno', content: { 'application/json': { schema: TemplateResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('template_name_conflict'),
    413: problemResponse('content_too_many_blocks'),
    422: problemResponse(
      'validation_failed',
      'template_document_invalid',
      'template_schema_too_new',
    ),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/templates/{id}',
  tags: [TAG],
  summary: 'Detail šablony',
  security: [{ bearerAuth: ['templates:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Šablona', content: { 'application/json': { schema: TemplateResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/templates/{id}',
  tags: [TAG],
  summary: 'Uložení návrhu s optimistickým zámkem',
  security: [{ bearerAuth: ['templates:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchTemplateRequest } } },
  },
  responses: {
    200: { description: 'Uloženo', content: { 'application/json': { schema: TemplateResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    // 409 přibylo s přejmenováním: jméno může být zabrané jinou šablonou.
    409: problemResponse('template_name_conflict'),
    412: problemResponse('precondition_failed'),
    413: problemResponse('content_too_many_blocks'),
    422: problemResponse(
      'validation_failed',
      'template_document_invalid',
      'template_schema_too_new',
    ),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/templates/{id}',
  tags: [TAG],
  summary: 'Smazání šablony',
  security: [{ bearerAuth: ['templates:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('template_starter_immutable', 'template_in_use'),
  },
});

/**
 * Vrácení smazané šablony zpět. Trasa existuje proto, aby smazání bylo vratné
 * a rozhraní ho tak smělo popsat: bez ní by potvrzovací okno muselo tvrdit, že
 * cesta zpátky není, ačkoli řádek v databázi po měkkém smazání zůstává.
 *
 * 409 nastane, když jméno mezitím zabrala jiná šablona.
 */
const restoreRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/restore',
  tags: [TAG],
  summary: 'Vrácení smazané šablony',
  security: [{ bearerAuth: ['templates:write'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Obnoveno', content: { 'application/json': { schema: TemplateResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('template_name_conflict'),
  },
});

const duplicateRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/duplicate',
  tags: [TAG],
  summary: 'Kopie šablony',
  security: [{ bearerAuth: ['templates:write'] }],
  request: { params: IdParam },
  responses: {
    201: { description: 'Kopie', content: { 'application/json': { schema: TemplateResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('template_name_conflict'),
  },
});

/**
 * Požadavek P08-R5. Oprávnění je `campaigns:send`, ne `templates:write`:
 * tahle cesta jako jediná v doméně šablon SKUTEČNĚ ODESÍLÁ e-mail. Kdo smí
 * upravit šablonu, nemusí tím pádem smět poslat poštu z domény projektu.
 */
const testSendRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/test-send',
  tags: [TAG],
  summary: 'Testovací odeslání šablony na vlastní adresy',
  security: [{ bearerAuth: ['campaigns:send'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: TestSendRequest } } },
  },
  responses: {
    202: {
      description: 'Zprávy jsou ve frontě. Odesílá je sender, ne tenhle požadavek.',
      content: { 'application/json': { schema: TestSendResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse(
      'validation_failed',
      'test_recipient_suppressed',
      'template_document_invalid',
    ),
    429: problemResponse('test_rate_limited'),
  },
});

const validateRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/validate',
  tags: [TAG],
  summary: 'Předodesílací kontrola šablony',
  security: [{ bearerAuth: ['templates:read'] }],
  request: {
    params: IdParam,
    query: z.object({ subject: z.string().max(400).optional() }),
  },
  responses: {
    200: {
      description: 'Nálezy, žádný z nich neblokuje odeslání',
      content: { 'application/json': { schema: ValidateResponse } },
    },
    409: {
      description: 'Mezi nálezy je aspoň jeden blokující',
      content: { 'application/json': { schema: ValidateResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const compileRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/compile',
  tags: [TAG],
  summary: 'Kompilace do HTML a prostého textu, bez uložení',
  security: [{ bearerAuth: ['templates:read'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: CompileRequest } } },
  },
  responses: {
    200: {
      description: 'Zkompilovaná šablona a metadata kontraktu 5',
      content: { 'application/json': { schema: CompileResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('template_document_invalid'),
  },
});

const previewRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/preview',
  tags: [TAG],
  summary: 'Náhled s dosazenými daty',
  security: [{ bearerAuth: ['templates:read'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PreviewRequest } } },
  },
  responses: {
    200: {
      description: 'Hotové HTML a prostý text',
      content: { 'application/json': { schema: PreviewResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('template_document_invalid', 'validation_failed'),
  },
});

const listVersionsRoute = createRoute({
  method: 'get',
  path: '/templates/{id}/versions',
  tags: [TAG],
  summary: 'Historie verzí šablony',
  security: [{ bearerAuth: ['templates:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Verze od nejnovější',
      content: { 'application/json': { schema: VersionListResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createVersionRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/versions',
  tags: [TAG],
  summary: 'Ruční uložení verze',
  security: [{ bearerAuth: ['templates:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: CreateVersionRequest } } },
  },
  responses: {
    201: { description: 'Verze', content: { 'application/json': { schema: VersionItem } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const restoreVersionRoute = createRoute({
  method: 'post',
  path: '/templates/{id}/versions/{version}/restore',
  tags: [TAG],
  summary: 'Obnovení staršího návrhu',
  security: [{ bearerAuth: ['templates:write'] }],
  request: {
    params: z.object({ id: Uuid, version: z.coerce.number().int().min(1) }),
  },
  responses: {
    201: {
      description: 'Nová verze z obnoveného návrhu',
      content: { 'application/json': { schema: VersionItem } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/* ------------------------------------------------------------------------ *
 * Handlery
 * ------------------------------------------------------------------------ */

export function registerTemplateRoutes(app: OpenAPIHono<TemplatesEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const q = c.req.valid('query');
    const options = {
      limit: q.limit,
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
      ...(q.kind === undefined ? {} : { kind: q.kind }),
      ...(q.category === undefined ? {} : { category: q.category }),
      ...(q.validation_state === undefined ? {} : { validationState: q.validation_state }),
    };
    /*
     * Úsporná podoba se NEOŘEZÁVÁ až z načtených řádků. `design` je největší
     * sloupec tabulky a `select()` bez výčtu sloupců ho vytáhne z databáze,
     * i kdyby ho odpověď zahodila; šetřilo by se pak jen na drátě, ne na dotazu.
     *
     * Zapojení se dotahuje JEDNÍM dotazem pro celou stránku, ne dotazem na
     * řádek. Dvacet pět položek v knihovně by jinak znamenalo dvacet pět
     * dotazů na formuláře a dalších dvacet pět na seznamy.
     */
    const page = await withWorkspace(ctx, async (tx) => {
      const [result, counts] = await Promise.all([
        q.view === 'summary'
          ? listTemplateSummaries(tx, ctx, options)
          : listTemplates(tx, ctx, options),
        countTemplatesByCategory(tx, ctx),
      ]);
      if (q.view !== 'summary') {
        return {
          items: (result.items as TemplateRow[]).map(present),
          nextCursor: result.nextCursor,
          counts,
        };
      }
      const rows = result.items as TemplateSummaryRow[];
      const usage = await loadTemplateUsage(
        tx,
        ctx,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) => presentSummary(row, usage.get(row.id) ?? EMPTY_TEMPLATE_USAGE)),
        nextCursor: result.nextCursor,
        counts,
      };
    }).catch((error: unknown) => {
      // Rozbitý kurzor je chyba volajícího, ne serveru.
      if (error instanceof Error && error.message === 'invalid_cursor') {
        throw new ApiError('validation_failed', {
          errors: [{ path: 'cursor', code: 'invalid_value', message: 'Kurzor není platný.' }],
        });
      }
      throw error;
    });
    return c.json({ items: page.items, next_cursor: page.nextCursor, counts: page.counts }, 200);
  });

  app.openapi(fieldUsageRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const items = await withWorkspace(ctx, (tx) =>
      findTemplateIdsUsingField(tx, ctx, c.req.valid('query').field),
    );
    return c.json({ items }, 200);
  });

  app.openapi(createTemplateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    const body = c.req.valid('json');
    const kind: TemplateKind = body.kind ?? 'campaign';
    const service = await serviceContext(ctx);
    const document = await requireValidDocument(ctx, service.fields, kind, body.document);
    try {
      const row = await createTemplate(service, { name: body.name, kind, document });
      return c.json(present(row), 201);
    } catch (error) {
      translateDomainError(error);
    }
  });

  app.openapi(getRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const row = await withWorkspace(ctx, (tx) => load(tx, ctx, c.req.valid('param').id));
    return c.json(present(row), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    /*
     * `name` UŽ SE NEZAHAZUJE.
     *
     * Schéma `PatchTemplateRequest` pole `name` mělo od začátku, jenže tenhle
     * handler ho nikdy nepřečetl a `design` navíc vyžadoval, takže samotné
     * přejmenování skončilo na 422 „Chybí `design`". Přejmenovat šablonu tedy
     * nešlo vůbec, ani z rozhraní, ani z API, a uživateli zůstávala jména jako
     * „E-mail z formuláře test".
     *
     * Poslat jde jedno, druhé, nebo obojí. Nic z toho je chyba volajícího.
     */
    if (body.design === undefined && body.name === undefined) {
      throw new ApiError('validation_failed', {
        errors: [
          { path: '', code: 'required_field_missing', message: 'Chybí `design` nebo `name`.' },
        ],
      });
    }
    const service = await serviceContext(ctx);
    let row: TemplateRow | undefined;
    try {
      if (body.design !== undefined) {
        const current = await withWorkspace(ctx, (tx) => load(tx, ctx, id));
        const document = await requireValidDocument(ctx, service.fields, current.kind, body.design);
        const result = await saveDesign(
          service,
          id,
          document,
          body.if_design_hash === undefined
            ? undefined
            : Buffer.from(body.if_design_hash.toLowerCase(), 'hex'),
        );
        row = result.row;
      }
      // Přejmenování až PO uložení návrhu, když přijde obojí. Mění dokument
      // (`meta.name`) i hash, takže jako druhé v pořadí vrací platný stav;
      // obráceně by ho uložení návrhu přepsalo starým jménem v dokumentu.
      if (body.name !== undefined) row = await renameTemplate(service, id, body.name);
      return c.json(present(row!), 200);
    } catch (error) {
      translateDomainError(error);
    }
  });

  app.openapi(deleteRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    try {
      await deleteTemplate(await serviceContext(ctx), c.req.valid('param').id);
    } catch (error) {
      translateDomainError(error);
    }
    return c.body(null, 204);
  });

  app.openapi(restoreRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    try {
      const row = await restoreTemplate(await serviceContext(ctx), c.req.valid('param').id);
      return c.json(present(row), 200);
    } catch (error) {
      translateDomainError(error);
    }
  });

  app.openapi(duplicateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    try {
      const row = await duplicateTemplate(await serviceContext(ctx), c.req.valid('param').id);
      return c.json(present(row), 201);
    } catch (error) {
      translateDomainError(error);
    }
  });

  app.openapi(testSendRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const service = await serviceContext(ctx);

    // Data pro dosazení se skládají TOUŽ cestou jako u náhledu. Kdyby si je
    // testovací odeslání skládalo vlastní, testoval by uživatel něco jiného,
    // než co v náhledu viděl.
    const input: PreviewDataInput = body.preview_data ?? { type: 'sample', variant: 'default' };
    const renderData = await withWorkspace(ctx, async (tx) => {
      const row = await load(tx, ctx, id);
      const language = sampleLanguage(languageOf(row.design));
      if (input.type === 'contact') {
        const found = await contactPreviewData(tx, ctx, language, input.contact_id);
        if (!found) throw new ApiError('not_found');
        return found as unknown as Record<string, unknown>;
      }
      // Ukázková data se SKUTEČNÝM projektem: zkušební odeslání jinak ukazuje
      // vyplněnou poštovní adresu i projektu, který žádnou nemá.
      return (await samplePreviewData(tx, ctx, language, input.variant)) as unknown as Record<
        string,
        unknown
      >;
    });

    try {
      const result = await sendTemplateTest(service, {
        templateId: id,
        recipients: body.recipients,
        renderData,
        assetBaseUrl: config().ASSET_BASE_URL,
      });
      // 202, ne 200: požadavek zprávy jen zařadil. Odesílá je sender, takže
      // v okamžiku odpovědi ještě žádný e-mail neodešel a tvrdit opak by byla lež.
      return c.json({ created: result.created, subject: result.subject }, 202);
    } catch (error) {
      translateTestSendError(error);
    }
  });

  app.openapi(validateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const service = await serviceContext(ctx);
    const id = c.req.valid('param').id;

    const { row, compiled, listEmail } = await withWorkspace(ctx, async (tx) => {
      const found = await load(tx, ctx, id);
      return {
        row: found,
        compiled: await compileFor(tx, ctx, found, service.fields),
        // Je šablona připojená k seznamu jako potvrzovací, uvítací nebo
        // rozloučovací e-mail? Rozhoduje to o jediné věci: jestli se po ní chce
        // odhlašovací odkaz. Zdůvodnění je u té kontroly v `precheck.ts`.
        listEmail: await isListEmailTemplate(tx, ctx, id),
      };
    });

    const design = row.design as Document;
    const validation = validateTemplateDocument(design, {
      templateKind: validationProfileFor(row.kind),
      fields: service.fields,
      assetIds: new Set(assetIdsInDocument(design)),
    });
    // Když se dokument nezkompiluje, předodesílací kontrola nemá z čeho počítat
    // velikost ani odkazy. Prázdná metadata jsou tu SCHVÁLNĚ: `precheck` z nich
    // vyrobí nález „chybí odkaz na odhlášení" plus nález z validace, což je
    // pravdivý popis stavu. Vracet 200 s prázdnými nálezy by lhalo.
    const meta: Pick<
      CompileMeta,
      'htmlBytes' | 'links' | 'assetIds' | 'warnings' | 'hasUnsubscribeLink'
    > = compiled.ok
      ? compiled.meta
      : { htmlBytes: 0, links: [], assetIds: [], warnings: [], hasUnsubscribeLink: false };

    /*
     * VEŘEJNÁ STRÁNKA PŘEDODESÍLACÍ KONTROLOU NEPROCHÁZÍ. Nikdy se neodesílá.
     *
     * `preSendCheck` odpovídá na otázku „smí tenhle e-mail ven", takže nad
     * stránkou vyrábí nálezy o něčem, co neexistuje: „E-mail nemá odkaz na
     * odhlášení" (stránka odhlašovací odkaz nemá kde mít) a „Adresa aplikace
     * není veřejná, takže odkazy v e-mailu by příjemcům nefungovaly" (stránka
     * se otevírá z prohlížeče, ne ze schránky). Autor pak v editoru viděl dvě
     * červené chyby, které nešly opravit, protože se netýkaly jeho práce.
     * Nahlásil zadavatel 7. 8. 2026 snímkem panelu nálezů.
     *
     * Kontrola DOKUMENTU (`validation.issues`) běží dál, jen se k ní nepřilepí
     * odesílací pravidla. Nálezy stránky, tedy zakázaná patička, zakázané syrové
     * HTML a nedostupná personalizace, vydává profil `page` a ty jsou správně.
     */
    if (validationProfileFor(row.kind as TemplateKind) === 'page') {
      const pageFindings = validation.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: resolveDetail(issue.code, config().DEFAULT_LOCALE),
        ...(issue.params === undefined ? {} : { params: issue.params }),
      }));
      const blocking = pageFindings.some((finding) => finding.severity === 'error');
      return blocking
        ? c.json({ findings: pageFindings }, 409)
        : c.json({ findings: pageFindings }, 200);
    }

    const check = preSendCheck({
      compileMeta: meta,
      validationIssues: validation.issues,
      subject: c.req.valid('query').subject ?? 'placeholder',
      preheader: design.meta.previewText,
      appUrl: config().APP_URL,
      emptyFieldRatios: [],
      unsubscribeRequired: !listEmail,
    });

    const findings = check.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: resolveDetail(finding.code, config().DEFAULT_LOCALE),
      ...(finding.params === undefined ? {} : { params: finding.params }),
    }));
    // 4xx jen tehdy, když je mezi nálezy aspoň jeden se závažností error.
    return check.blocking ? c.json({ findings }, 409) : c.json({ findings }, 200);
  });

  app.openapi(compileRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const service = await serviceContext(ctx);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');

    const result = await withWorkspace(ctx, async (tx) => {
      const row = await load(tx, ctx, id);
      return compileFor(tx, ctx, row, service.fields, body.campaign_id);
    });
    if (!result.ok) {
      throw new ApiError('template_document_invalid', { findings: findingsOf(result.issues) });
    }
    return c.json(
      {
        html: result.html,
        text: result.text,
        meta: {
          contract_version: result.meta.contractVersion,
          renderer_version: result.meta.rendererVersion,
          schema_version: result.meta.schemaVersion,
          used_paths: result.meta.usedPaths,
          render_schema: result.meta.renderSchema as unknown as Record<string, unknown>,
          links: result.meta.links as unknown as Array<Record<string, unknown>>,
          asset_ids: result.meta.assetIds,
          html_bytes: result.meta.htmlBytes,
          text_bytes: result.meta.textBytes,
          warnings: result.meta.warnings as unknown as Array<Record<string, unknown>>,
          has_unsubscribe_link: result.meta.hasUnsubscribeLink,
          click_marker_count: result.meta.clickMarkerCount,
          has_open_pixel_slot: result.meta.hasOpenPixelSlot,
        },
      },
      200,
    );
  });

  app.openapi(previewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const service = await serviceContext(ctx);
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');

    const { compiled, data } = await withWorkspace(ctx, async (tx) => {
      const row = await load(tx, ctx, id);
      const language = sampleLanguage(languageOf(row.design));
      const result = await compileFor(tx, ctx, row, service.fields);
      const input: PreviewDataInput = body.preview_data ?? { type: 'sample', variant: 'default' };
      if (input.type === 'contact') {
        const found = await contactPreviewData(tx, ctx, language, input.contact_id);
        if (!found) throw new ApiError('not_found');
        return { compiled: result, data: found as unknown as Record<string, unknown> };
      }
      return {
        compiled: result,
        data: (await samplePreviewData(tx, ctx, language, input.variant)) as unknown as Record<
          string,
          unknown
        >,
      };
    });

    if (!compiled.ok) {
      throw new ApiError('template_document_invalid', { findings: findingsOf(compiled.issues) });
    }

    // `render_data` z těla vyhrává jen tehdy, když klient neposlal `preview_data`.
    // Mapu `_present` plní `prepareRenderData` podle `renderSchema.presence`,
    // stejně jako při odeslání. Kdyby ji náhled vynechal, podmíněné bloky by
    // v náhledu zmizely, ale v odeslaném e-mailu zůstaly.
    const raw =
      body.preview_data === undefined && body.render_data !== undefined ? body.render_data : data;
    const prepared = prepareRenderData(raw, toPreparedSchema(compiled.meta.renderSchema));

    const [html, text] = await Promise.all([
      createHtmlEngine().parseAndRender(compiled.html, prepared),
      createTextEngine().parseAndRender(compiled.text, prepared),
    ]);
    return c.json({ html, text }, 200);
  });

  app.openapi(listVersionsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const id = c.req.valid('param').id;
    const rows = await withWorkspace(ctx, async (tx) => {
      await load(tx, ctx, id);
      return listVersions(tx, ctx, id);
    });
    return c.json({ items: rows.map(presentVersion) }, 200);
  });

  app.openapi(createVersionRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    try {
      // Zámek řádku v `createVersion` platí jen uvnitř transakce, proto ji
      // otevírá tahle vrstva. Bez ní by `FOR UPDATE` nezamkl nic a dvě souběžná
      // uložení by vyrobila dvě verze se stejným číslem.
      const row = await withWorkspace(ctx, (tx) =>
        createVersion(tx, ctx, id, {
          reason: 'manual',
          ...(body.label === undefined ? {} : { label: body.label }),
          ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
          ...(ctx.actor.type === 'user' ? { createdBy: ctx.actor.userId } : {}),
        }),
      );
      return c.json(presentVersion(row), 201);
    } catch (error) {
      translateDomainError(error);
    }
  });

  app.openapi(restoreVersionRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:write');
    const params = c.req.valid('param');
    try {
      // Transakci i výpočet `used_fields` dělá služba: potřebuje k tomu katalog
      // polí, a ten je doména kontaktů, ne HTTP vrstva.
      const row = await restoreTemplateVersion(
        await serviceContext(ctx),
        params.id,
        params.version,
      );
      return c.json(presentVersion(row), 201);
    } catch (error) {
      translateDomainError(error);
    }
  });
}
