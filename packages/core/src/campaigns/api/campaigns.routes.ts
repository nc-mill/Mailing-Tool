import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import type { WorkspaceContext } from '../../tx';
// Předvolby odesílatele jsou vlastní doména, ale kampaň je ten, kdo se z nich
// předvyplňuje, takže se odsud čte jedna jediná funkce. Opačný směr (doména
// předvoleb by sahala do kampaní) by udělal kruh.
import { getDefaultSenderIdentity } from '../../sender-identities/repo';
import { AUDIENCE_CONFIRM_TOLERANCE } from '../constants';
import { cancelCampaign } from '../control/cancel';
import { pauseCampaign } from '../control/pause';
import { releaseCampaignNow } from '../control/release-now';
import { resumeCampaign } from '../control/resume';
import { EDITABLE_WHILE_SCHEDULED, validateSchedule } from '../control/schedule';
import { undoState } from '../control/undo';
import { withPending } from '../types';
import type { CampaignCompilation } from '../compile';
import { assertCompilationCurrent, compileCampaign } from '../compile-service';
import { applyTemplateToCampaign } from '../template-apply';
import { buildPauseReason } from '../pause-reason';
import { startMaterialization } from '../repo/audience-progress';
import { readLiveDelivery, readLiveHandover } from '../repo/live-progress';
import { readSentPreview, transitionStatus } from '../repo/campaign';
import { MATERIALIZE_JOB } from '../jobs/materialize';
import {
  audienceState,
  parseAudience,
  runCampaignPreflight,
  EMPTY_BREAKDOWN,
} from './preflight-view';
import {
  ApplyTemplateRequest,
  ApplyTemplateResponse,
  AudiencePreviewResponse,
  CampaignResponse,
  CampaignSentPreviewResponse,
  CompileCampaignResponse,
  CreateCampaignRequest,
  MessageItem,
  PatchCampaignRequest,
  PreflightResponse,
  ProgressResponse,
  ScheduleCampaignRequest,
  SendCampaignRequest,
  Uuid,
} from './schemas';
import {
  counters,
  createCampaign,
  duplicateCampaign,
  enqueueInWorkspace,
  getCampaignFull,
  listCampaignMessages,
  listCampaigns,
  readWorkspaceSettings,
  requireCampaign,
  softDeleteCampaign,
  undoRemainingSeconds,
  undoWindowSeconds,
  updateCampaign,
  type CampaignRowFull,
} from './service';
import type { CampaignsEnv } from './index';

const TAG = 'Campaigns';

/**
 * Časová zóna projektu. Požadavek na to, aby ji nesl `WorkspaceContext`, je ke dni
 * psaní nesplněný, takže se bere táž výchozí hodnota jako v doméně segmentů.
 * Až kontext zónu ponese, mění se to na jednom místě tady.
 */
const WORKSPACE_TIMEZONE = 'Europe/Prague';

const IdParam = z.object({ id: Uuid });

/**
 * Stavy, ze kterých `startMaterialization` kampaň zabere. Je to TÝŽ výčet, jaký má
 * ten dotaz ve `WHERE`; kdyby se rozešly, kontrola před odesláním by běžela nad
 * kampaní, kterou stejně nikdo neodešle, a její chyba by přebila správné 409.
 */
const SENDABLE_FROM: readonly string[] = ['draft', 'scheduled', 'schedule_missed'];

/**
 * Stavy, ze kterých už rozesílka nikam nepokročí. Posílá se jako jeden příznak,
 * aby obrazovka nemusela ten výčet držet podruhé: podle něj přestane obnovovat.
 * Výčet je týž, jaký má `campaignTarget` ve webu pro cíl „report".
 */
const FINISHED_STATUSES: readonly string[] = ['sent', 'partially_sent', 'cancelled', 'failed'];

function present(row: CampaignRowFull): z.infer<typeof CampaignResponse> {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    subject: row.subject,
    preheader: row.preheader,
    from_name: row.from_name,
    from_email: row.from_email,
    reply_to: row.reply_to,
    template_id: row.template_id,
    has_design: row.has_design,
    has_content: row.content_block_count > 0,
    content_block_count: row.content_block_count,
    audience: row.audience,
    audience_size: row.audience_size,
    audience_breakdown: row.audience_breakdown ?? null,
    audience_built_at: row.audience_built_at,
    provider_id: row.provider_id,
    sender_domain_id: row.sender_domain_id,
    sender_identity_id: row.sender_identity_id,
    unsubscribe_list_id: row.unsubscribe_list_id,
    track_opens: row.track_opens,
    track_clicks: row.track_clicks,
    revision: row.revision,
    release_at: row.release_at,
    scheduled_at: row.scheduled_at,
    schedule_timezone: row.schedule_timezone,
    pause_reason: row.pause_reason ?? null,
    counters: counters(row),
    started_at: row.started_at,
    finished_at: row.finished_at,
    paused_at: row.paused_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function load(ctx: WorkspaceContext, id: string): Promise<CampaignRowFull> {
  return requireCampaign(await getCampaignFull(ctx, id));
}

/**
 * Předvyplnění nové kampaně z VÝCHOZÍ předvolby odesílatele.
 *
 * Dělá se to na serveru, ne v obrazovce, a je to podstatný rozdíl. Kampaň
 * nevzniká jen z formuláře: zakládá ji i ukázková data, onboarding a klient přes
 * API klíč. Kdyby předvyplnění bydlelo v obrazovce, mělo by ho přesně jedno
 * z těch čtyř míst a ostatní tři by dělaly kampaně s prázdným odesílatelem.
 *
 * VYPLNĚNÉ POLE SE NIKDY NEPŘEPÍŠE. Doplňuje se jen to, co volající neposlal;
 * kdo si odesílatele určuje sám, ať už je to klient API nebo průvodce
 * onboardingem, dostane přesně to, co si řekl. Proto se pole testují každé
 * zvlášť a ne blokem.
 *
 * Když projekt výchozí předvolbu nemá, nestane se nic. Není to chyba, je to
 * úplně běžný stav prvních minut instalace.
 */
async function prefillFromDefaultSender(
  ctx: WorkspaceContext,
  body: z.infer<typeof CreateCampaignRequest>,
): Promise<z.infer<typeof CreateCampaignRequest>> {
  const missing =
    body.from_name === undefined ||
    body.from_email === undefined ||
    body.reply_to === undefined ||
    body.provider_id === undefined ||
    body.sender_domain_id === undefined;
  if (!missing) return body;

  const identity = await getDefaultSenderIdentity(ctx);
  if (identity === null) return body;

  return {
    ...body,
    ...(body.from_name === undefined ? { from_name: identity.from_name } : {}),
    ...(body.from_email === undefined ? { from_email: identity.from_email } : {}),
    ...(body.reply_to === undefined ? { reply_to: identity.reply_to } : {}),
    ...(body.provider_id === undefined ? { provider_id: identity.provider_id } : {}),
    ...(body.sender_domain_id === undefined ? { sender_domain_id: identity.sender_domain_id } : {}),
    // Odkaz na předvolbu se doplňuje jen tehdy, když se z ní opravdu bralo.
    // Kdyby se zapsal vždycky, tvrdila by kampaň s ručně vyplněnou adresou,
    // že vznikla z předvolby, a obrazovka by u ní ukazovala cizí jméno.
    ...(body.sender_identity_id === undefined && body.from_email === undefined
      ? { sender_identity_id: identity.id }
      : {}),
  };
}

const listRoute = createRoute({
  method: 'get',
  path: '/campaigns',
  tags: [TAG],
  summary: 'Kampaně projektu',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: {
    query: z.object({
      status: z.string().max(40).optional(),
      cursor: Uuid.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  },
  responses: {
    200: {
      description: 'Kampaně',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(CampaignResponse), has_more: z.boolean() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/campaigns',
  tags: [TAG],
  summary: 'Nová kampaň',
  security: [{ bearerAuth: ['campaigns:write'] }],
  request: { body: { content: { 'application/json': { schema: CreateCampaignRequest } } } },
  responses: {
    201: { description: 'Založeno', content: { 'application/json': { schema: CampaignResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}',
  tags: [TAG],
  summary: 'Jedna kampaň',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Kampaň', content: { 'application/json': { schema: CampaignResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/campaigns/{id}',
  tags: [TAG],
  summary: 'Úprava kampaně',
  security: [{ bearerAuth: ['campaigns:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchCampaignRequest } } },
  },
  responses: {
    200: { description: 'Upraveno', content: { 'application/json': { schema: CampaignResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('campaign_locked'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/campaigns/{id}',
  tags: [TAG],
  summary: 'Smazání rozepsané kampaně',
  security: [{ bearerAuth: ['campaigns:delete'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict'),
  },
});

const duplicateRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/duplicate',
  tags: [TAG],
  summary: 'Kopie kampaně',
  security: [{ bearerAuth: ['campaigns:write'] }],
  request: { params: IdParam },
  responses: {
    201: { description: 'Kopie', content: { 'application/json': { schema: CampaignResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const previewRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/audience/preview',
  tags: [TAG],
  summary: 'Náhled publika s rozpadem po branách',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Počet a rozpad',
      content: { 'application/json': { schema: AudiencePreviewResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Náhled odeslané podoby kampaně, JEN KE ČTENÍ.
 *
 * Vrací uložené sloupce, nikdy nekompiluje znovu. Kompilace u odeslané kampaně
 * může vydat jiné tělo, než jaké odešlo (mezitím se změnila šablona, asset nebo
 * emitter), a náhled existuje právě proto, aby se uživatel podíval na to, co
 * doopravdy dostali příjemci.
 *
 * Cesta je `/campaigns/{id}/preview`, kdežto odhad publika sedí na
 * `/campaigns/{id}/audience/preview`. Jsou to dvě různé věci a nekříží se.
 */
const sentPreviewRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/preview',
  tags: [TAG],
  summary: 'Odeslaná podoba kampaně',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description:
        'Uložená podoba. Nezkompilovaná kampaň vrací 200 s html null, ne 404: kampaň existuje.',
      content: { 'application/json': { schema: CampaignSentPreviewResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const preflightRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/preflight',
  tags: [TAG],
  summary: 'Kontrolní seznam připravenosti',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Dotaz na stav, ne pokus o akci: vrací VŽDY 200 s vyplněným findings.',
      content: { 'application/json': { schema: PreflightResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Použití šablony na kampaň: zkopíruje dokument do obsahu kampaně a rovnou ho
 * zkompiluje. Jediná cesta, která smí obsah kampaně PŘEPSAT.
 *
 * Samostatná trasa, ne klíč v `PATCH`, ze tří důvodů. Za prvé je to z pohledu
 * uživatele jedna operace („vezmi šablonu a připrav kampaň k odeslání"), ne dvě.
 * Za druhé přepisuje obsah, tedy jedinou věc, o kterou jde přijít nenávratně,
 * a taková věc nemá viset na uložení formuláře, kde ji uživatel nečeká. Za třetí
 * vrací `overwritten`, takže obrazovka ví, co se stalo, a umí se zeptat předem
 * (podle `has_design` v odpovědi kampaně).
 */
const applyTemplateRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/apply-template',
  tags: [TAG],
  summary: 'Použití šablony na kampaň',
  security: [{ bearerAuth: ['campaigns:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ApplyTemplateRequest } } },
  },
  responses: {
    200: {
      description: 'Obsah zkopírován, zkompilován jen když kampaň má předmět',
      content: { 'application/json': { schema: ApplyTemplateResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('campaign_locked'),
    /*
     * `campaign_subject_missing` tady UŽ NENÍ a je to podstatná změna. Chybějící
     * předmět nebyl neúspěch převzetí obsahu: dokument se zkopíroval a chyba
     * mluvila o kompilaci, tedy o kroku, který se dá odložit. Odpověď proto vrací
     * `compiled: null` a předmět hlídá kontrola před odesláním.
     */
    422: problemResponse('template_document_invalid'),
  },
});

/**
 * Kompilace kampaně. Je to samostatná trasa, ne vedlejší účinek uložení nastavení.
 *
 * Plán trasu nepředepisuje, rozhoduje se tady a důvod je v tom, že kompilace může
 * selhat z důvodů, které se nastavení kampaně netýkají (rozbitá šablona, chybějící
 * asset). Kdyby visela na `PATCH`, uložení nastavení by padalo na chybě obsahu
 * a uživatel by nedokázal opravit ani to, co s obsahem nesouvisí. Obrazovka
 * nastavení ji volá hned po úspěšném uložení, takže druhé tlačítko nepotřebuje.
 */
const compileRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/compile',
  tags: [TAG],
  summary: 'Kompilace obsahu kampaně',
  security: [{ bearerAuth: ['campaigns:write'] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Zkompilováno, výsledek uložen',
      content: { 'application/json': { schema: CompileCampaignResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('campaign_locked'),
    422: problemResponse('campaign_not_compiled', 'campaign_subject_missing'),
  },
});

const sendRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/send',
  tags: [TAG],
  summary: 'Odeslání kampaně',
  security: [{ bearerAuth: ['campaigns:send'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: SendCampaignRequest } } },
  },
  responses: {
    202: {
      description: 'Přijato, publikum se materializuje',
      content: {
        'application/json': {
          schema: z.object({
            id: Uuid,
            undo_window_seconds: z.number().int(),
            warnings: z.array(z.object({ code: z.string(), severity: z.string() })),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('invalid_state_transition', 'campaign_audience_changed'),
    422: problemResponse('campaign_not_sendable'),
  },
});

const scheduleRoute = createRoute({
  method: 'post',
  path: '/campaigns/{id}/schedule',
  tags: [TAG],
  summary: 'Naplánování kampaně',
  security: [{ bearerAuth: ['campaigns:send'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: ScheduleCampaignRequest } } },
  },
  responses: {
    200: {
      description: 'Naplánováno',
      content: { 'application/json': { schema: CampaignResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('invalid_state_transition', 'campaign_audience_changed'),
    422: problemResponse('campaign_schedule_too_soon', 'campaign_schedule_too_far'),
  },
});

function simpleAction(path: string, summary: string, scope: string) {
  return createRoute({
    method: 'post',
    path: `/campaigns/{id}/${path}`,
    tags: [TAG],
    summary,
    security: [{ bearerAuth: [scope] }],
    request: { params: IdParam },
    responses: {
      200: { description: summary, content: { 'application/json': { schema: CampaignResponse } } },
      401: problemResponse('unauthenticated'),
      403: problemResponse('forbidden', 'insufficient_scope'),
      404: problemResponse('not_found'),
      409: problemResponse('invalid_state_transition', 'campaign_undo_window_expired'),
      422: problemResponse('provider_sending_paused'),
    },
  });
}

const unscheduleRoute = simpleAction('unschedule', 'Zrušení plánu', 'campaigns:send');
const pauseRoute = simpleAction('pause', 'Pozastavení rozesílky', 'campaigns:control');
const resumeRoute = simpleAction('resume', 'Pokračování rozesílky', 'campaigns:control');
const cancelRoute = simpleAction('cancel', 'Zrušení zbytku rozesílky', 'campaigns:control');
const undoRoute = simpleAction('undo', 'Vzetí odeslání zpět v okně', 'campaigns:send');
/**
 * Druhá polovina okna na vzetí zpět. `undo` ho ukončí zrušením kampaně,
 * `send-now` ho ukončí tím, že rozesílku pustí okamžitě.
 */
const sendNowRoute = simpleAction('send-now', 'Okamžité odeslání bez čekání', 'campaigns:send');

const progressRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/progress',
  tags: [TAG],
  summary: 'Průběh rozesílky',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Průběh', content: { 'application/json': { schema: ProgressResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const messagesRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/messages',
  tags: [TAG],
  summary: 'Zprávy kampaně',
  security: [{ bearerAuth: ['campaigns:read'] }],
  request: {
    params: IdParam,
    query: z.object({
      status: z.string().max(40).optional(),
      cursor: Uuid.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'Zprávy, vždy s id I created_at',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(MessageItem), has_more: z.boolean() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerCampaignRoutes(app: OpenAPIHono<CampaignsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const q = c.req.valid('query');
    const page = await listCampaigns(ctx, {
      ...(q.status === undefined ? {} : { status: q.status }),
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
      limit: q.limit,
    });
    return c.json({ data: page.rows.map(present), has_more: page.hasMore }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:write');
    const body = c.req.valid('json');
    const row = await createCampaign(ctx, {
      ...(await prefillFromDefaultSender(ctx, body)),
      ...(ctx.actor.type === 'user' ? { createdBy: ctx.actor.userId } : {}),
    });
    return c.json(present(row), 201);
  });

  app.openapi(getRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    return c.json(present(await load(ctx, c.req.valid('param').id)), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:write');
    const body = c.req.valid('json');
    const current = await load(ctx, c.req.valid('param').id);

    const touched = Object.keys(body);
    const lockedByState = current.status !== 'draft' && current.status !== 'schedule_missed';
    // `EDITABLE_WHILE_SCHEDULED` je v doméně N-tice, ne množina. `has` na ní
    // neexistuje a přeložit by to nešlo, `includes` je ta správná metoda.
    const editable: readonly string[] = EDITABLE_WHILE_SCHEDULED;
    const onlyAllowed = touched.every((k) => editable.includes(k));

    if (lockedByState && !(current.status === 'scheduled' && onlyAllowed)) {
      // UI nabízí „Zrušit plán a upravit", což je jiná akce než u obecného konfliktu.
      throw new ApiError('campaign_locked', { params: { status: current.status } });
    }
    const row = await updateCampaign(ctx, current.id, body as Record<string, unknown>);
    return c.json(present(requireCampaign(row)), 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:delete');
    const current = await load(ctx, c.req.valid('param').id);
    const r = await softDeleteCampaign(ctx, current.id);
    if (!r.deleted) {
      // Stav se posílá s sebou: bez něj by rozhraní hlásilo obecné „nejde to"
      // a uživatel by nevěděl, jestli má čekat, zrušit plán, nebo to vzdát.
      throw new ApiError('conflict', {
        params: { reason: 'campaign_not_draft', status: current.status },
      });
    }
    return c.body(null, 204);
  });

  app.openapi(duplicateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:write');
    const row = await duplicateCampaign(ctx, c.req.valid('param').id);
    return c.json(present(requireCampaign(row)), 201);
  });

  app.openapi(previewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const campaign = await load(ctx, c.req.valid('param').id);
    const audience = parseAudience(campaign.audience);
    const asOf = new Date();
    if (!audience) {
      return c.json(
        {
          audience_estimate: 0,
          breakdown: EMPTY_BREAKDOWN,
          checked_at: asOf.toISOString(),
        },
        200,
      );
    }
    const state = await audienceState(ctx, audience, { asOf, timezone: WORKSPACE_TIMEZONE });
    return c.json(
      {
        audience_estimate: state.estimate,
        breakdown: state.breakdown,
        checked_at: asOf.toISOString(),
      },
      200,
    );
  });

  /** Výsledek kompilace pro odpověď. Sdílí ho `/compile` i `/apply-template`. */
  async function compileResult(
    ctx: WorkspaceContext,
    id: string,
    compilation: CampaignCompilation,
  ): Promise<z.infer<typeof CompileCampaignResponse>> {
    const after = await load(ctx, id);
    return {
      id,
      revision: after.revision,
      compiled_hash: compilation.compiledHash,
      html_bytes: Buffer.byteLength(compilation.html, 'utf8'),
      link_count: compilation.compileMeta.links.length,
      click_marker_count: compilation.compileMeta.clickMarkerCount,
      has_unsubscribe_link: compilation.compileMeta.hasUnsubscribeLink,
    };
  }

  app.openapi(applyTemplateRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:write');
    const id = c.req.valid('param').id;
    const applied = await applyTemplateToCampaign(ctx, id, c.req.valid('json').template_id);
    return c.json(
      {
        overwritten: applied.overwritten,
        // `null` znamená „obsah je v kampani, kompilace čeká na předmět".
        compiled:
          applied.compilation === null ? null : await compileResult(ctx, id, applied.compilation),
      },
      200,
    );
  });

  app.openapi(compileRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:write');
    const id = c.req.valid('param').id;
    return c.json(await compileResult(ctx, id, await compileCampaign(ctx, id)), 200);
  });

  app.openapi(sentPreviewRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const row = await readSentPreview(ctx, c.req.valid('param').id);
    if (!row) throw new ApiError('not_found');
    return c.json(
      {
        html: row.compiled_html,
        text: row.compiled_text,
        /*
         * Ovladač vrací `timestamptz` jako `Date`, protože v projektu nikdo
         * nenastavuje vlastní parser typů. Kontrakt slibuje řetězec, tak se
         * převádí tady a ne až v serializaci, aby odpověď byla tvarem shodná
         * i pro toho, kdo funkci volá z kódu.
         */
        compiled_at: row.compiled_at === null ? null : new Date(row.compiled_at).toISOString(),
        revision: row.revision,
        status: row.status,
        subject: row.subject,
      },
      200,
    );
  });

  app.openapi(preflightRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const campaign = await load(ctx, c.req.valid('param').id);
    const view = await runCampaignPreflight(ctx, campaign, {
      asOf: new Date(),
      timezone: WORKSPACE_TIMEZONE,
    });
    return c.json(view, 200);
  });

  app.openapi(sendRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const body = c.req.valid('json');
    const campaign = await load(ctx, c.req.valid('param').id);
    const pre = await runCampaignPreflight(ctx, campaign, {
      asOf: new Date(),
      timezone: WORKSPACE_TIMEZONE,
    });

    const drift = Math.abs(pre.audience_estimate - body.confirm_recipient_count);
    if (drift > Math.max(1, pre.audience_estimate * AUDIENCE_CONFIRM_TOLERANCE)) {
      throw new ApiError('campaign_audience_changed', {
        params: { expected: body.confirm_recipient_count, actual: pre.audience_estimate },
      });
    }
    if (!pre.can_send) {
      throw new ApiError('campaign_not_sendable', {
        findings: pre.findings.map((f) => ({
          code: f.code,
          severity: f.severity,
          message: f.code,
          ...(f.params === undefined ? {} : { params: f.params }),
        })),
      });
    }

    /*
     * Třetí část rozhodnutí D17: rekompilace a porovnání s uloženou `compile_meta`.
     * Musí být AŽ TADY, po preflightu a po potvrzení počtu, protože je to jediná
     * operace v celé cestě, která zapisuje. Při neshodě se kampaň neodešle.
     *
     * Bez tohohle volání by rozejitá ID odkazů znamenala, že report kliků zůstane
     * prázdný, a poznalo by se to týdny po odeslání, bez jediné chybové hlášky.
     * Registr kódů dává `contract_mismatch` stav 422, ne 409 z textu rozhodnutí;
     * registr vlastní P01 a měnit se kvůli tomu nebude.
     *
     * Běží jen u stavů, ze kterých `startMaterialization` kampaň opravdu zabere.
     * U odeslané kampaně je správná odpověď 409 o stavu, ne hlášení o obsahu:
     * obsah odeslané kampaně už měnit nejde a mluvit o něm by mátlo.
     */
    if (SENDABLE_FROM.includes(campaign.status)) {
      await assertCompilationCurrent(ctx, campaign.id);
    }

    /*
     * Přechod dělá `startMaterialization`, ne samostatný UPDATE. Je to jediný dotaz,
     * který v jedné operaci zabere kampaň, zapíše `audience_built_at` (invariant I1)
     * a spočítá `release_at`, tedy konec okna na zrušení. Dvě souběžná volání proto
     * skončí tak, že jedno vrátí `claimed: true` a druhé `false`, což je požadované
     * chování „jedno 202, druhé 409".
     */
    const started = await startMaterialization(ctx, campaign.id, pre.undo_window_seconds);
    if (!started.claimed) {
      const now = await load(ctx, campaign.id);
      throw new ApiError('invalid_state_transition', { params: { status: now.status } });
    }

    /*
     * Když se úloha nezařadí, kampaň NESMÍ zůstat viset v `queueing`: nikdo by ji
     * nezpracoval a uživatel by viděl „připravuje se" navždy. Přechod se proto vrátí
     * zpátky a chyba se ohlásí nahlas. `audience_built_at` zůstává vyplněné schválně,
     * je to hodnota invariantu I1 a opakované odeslání ji podle `COALESCE` znovu použije.
     *
     * Ověřeno spuštěním proti vývojové databázi, kde schéma pg-boss ještě nemělo
     * tabulky: bez tohohle bloku skončilo odeslání chybou 500 a kampaň zůstala
     * ve stavu `queueing` s vyplněným `audience_built_at`.
     */
    try {
      await enqueueInWorkspace(
        ctx,
        MATERIALIZE_JOB.queue,
        { campaignId: campaign.id, workspaceId: ctx.workspaceId },
        { singletonKey: MATERIALIZE_JOB.singletonKey(campaign.id) },
      );
    } catch (err) {
      await transitionStatus(ctx, {
        campaignId: campaign.id,
        to: campaign.status,
        from: ['queueing'],
      });
      throw new ApiError('service_unavailable', {
        params: { reason: 'campaign_materialize_not_queued' },
        cause: err,
      });
    }

    // Varování se u úspěchu předávají v odpovědi, ne v chybě.
    return c.json(
      {
        id: campaign.id,
        undo_window_seconds: pre.undo_window_seconds,
        warnings: pre.findings
          .filter((f) => f.severity === 'warning')
          .map((f) => ({ code: f.code, severity: f.severity })),
      },
      202,
    );
  });

  app.openapi(scheduleRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const body = c.req.valid('json');
    const campaign = await load(ctx, c.req.valid('param').id);
    const pre = await runCampaignPreflight(ctx, campaign, {
      asOf: new Date(),
      timezone: WORKSPACE_TIMEZONE,
    });

    const drift = Math.abs(pre.audience_estimate - body.confirm_recipient_count);
    if (drift > Math.max(1, pre.audience_estimate * AUDIENCE_CONFIRM_TOLERANCE)) {
      throw new ApiError('campaign_audience_changed', {
        params: { expected: body.confirm_recipient_count, actual: pre.audience_estimate },
      });
    }
    if (!pre.can_send) {
      throw new ApiError('campaign_not_sendable', {
        findings: pre.findings.map((f) => ({
          code: f.code,
          severity: f.severity,
          message: f.code,
        })),
      });
    }

    const validated = validateSchedule({
      at: new Date(body.scheduled_at),
      timezone: body.timezone,
      now: new Date(),
    });
    if (!validated.ok) throw new ApiError(validated.code, { params: { detail: validated.detail } });

    const moved = await transitionStatus(ctx, {
      campaignId: campaign.id,
      to: 'scheduled',
      from: ['draft', 'schedule_missed'],
      set: { scheduled_at: validated.at, schedule_timezone: validated.timezone },
    });
    if (!moved) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  app.openapi(unscheduleRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const campaign = await load(ctx, c.req.valid('param').id);
    const moved = await transitionStatus(ctx, {
      campaignId: campaign.id,
      to: 'draft',
      from: ['scheduled'],
      set: { scheduled_at: null, schedule_timezone: null },
    });
    if (!moved) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  app.openapi(pauseRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:control');
    const campaign = await load(ctx, c.req.valid('param').id);
    const r = await pauseCampaign(ctx, campaign.id, buildPauseReason('user', 'user'));
    if (!r.paused) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  app.openapi(resumeRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:control');
    const campaign = await load(ctx, c.req.valid('param').id);

    // Kampaň zastavenou Amazonem nemá smysl pouštět dál: odesílání by hned spadlo
    // a účet by to poškodilo ještě víc (kritérium 7 části 4a).
    const reason = campaign.pause_reason as { code?: string } | null;
    if (reason?.code === 'provider_blocked') {
      throw new ApiError('provider_sending_paused', { params: { campaign_id: campaign.id } });
    }

    const r = await resumeCampaign(ctx, campaign.id);
    if (!r.resumed) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    // Po pauze během materializace se kampaň vrací do queueing a job musí navázat
    // od kurzoru; bez nového zařazení by kampaň zůstala stát s hotovým publikem.
    if (r.status === 'queueing') {
      await enqueueInWorkspace(
        ctx,
        MATERIALIZE_JOB.queue,
        { campaignId: campaign.id, workspaceId: ctx.workspaceId },
        { singletonKey: MATERIALIZE_JOB.singletonKey(campaign.id) },
      );
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  app.openapi(cancelRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:control');
    const campaign = await load(ctx, c.req.valid('param').id);
    const r = await cancelCampaign(ctx, campaign.id, { reason: 'user' });
    if (!r.cancelled) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  app.openapi(undoRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const campaign = await load(ctx, c.req.valid('param').id);
    const state = undoState({
      sentCount: campaign.sent_count,
      releaseAt: campaign.release_at === null ? null : new Date(campaign.release_at),
      now: new Date(),
    });
    // Jediný stav, kde je zaručeno, že neodešel ani jeden mail. Po vypršení okna
    // se kampaň zastavit dá, ale odeslané zprávy zpátky vzít nejde.
    if (!state.canUndo) throw new ApiError('campaign_undo_window_expired');

    const r = await cancelCampaign(ctx, campaign.id, { reason: 'undo' });
    if (!r.cancelled) {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  /**
   * Přeskočení odpočtu. Uživatel si o to řekl výslovně, takže se nic
   * nepotvrzuje podruhé; jediná kontrola je, že se kampaň vůbec odesílá.
   *
   * Kampaň, které okno mezitím uplynulo samo, NENÍ chyba: `releaseCampaignNow`
   * nemá co uvolnit a odpoví 200. Kdyby to bylo 409, dostal by uživatel chybu
   * za to, že zmáčkl tlačítko o vteřinu později, než odpočet doběhl.
   */
  app.openapi(sendNowRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:send');
    const campaign = await load(ctx, c.req.valid('param').id);
    if (campaign.status !== 'queueing' && campaign.status !== 'sending') {
      throw new ApiError('invalid_state_transition', { params: { status: campaign.status } });
    }
    await releaseCampaignNow(ctx, campaign.id);
    return c.json(present(await load(ctx, campaign.id)), 200);
  });

  /**
   * Průběh se čte ŽIVĚ z `messages` a `message_events`, ne ze sloupců
   * `campaigns.*_count`.
   *
   * Ty sloupce plní cronová úloha `campaign.watchdog` jednou za patnáct sekund,
   * takže obrazovka obnovovaná po několika sekundách ukazovala mezi dvěma tiky
   * pořád totéž. U kampaně na tři adresy se ukazatel nepohnul ani jednou:
   * uživatel viděl nuly a pak rovnou hotovo. Živé čtení je ta samá agregace,
   * jakou hlídač zapisuje, jen bez zápisu, takže se čísla nemůžou rozejít.
   *
   * Ostatní cesty (`present`, seznam kampaní, report) čtou uložené sloupce dál.
   * Tenhle koncový bod je jediný, který se ptá NA BĚŽÍCÍ ROZESÍLKU, a jediný,
   * kde je patnáctisekundové zpoždění vidět.
   */
  app.openapi(progressRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const campaign = await load(ctx, c.req.valid('param').id);
    const now = new Date();

    const [handover, delivery] = await Promise.all([
      readLiveHandover(ctx, {
        campaignId: campaign.id,
        audienceBuiltAt: campaign.audience_built_at,
      }),
      readLiveDelivery(ctx, campaign.id),
    ]);

    const c8 = withPending({
      total: handover.total,
      sent: handover.sent,
      failed: handover.failed,
      skipped: handover.skipped,
      delivered: delivery.delivered,
      bounced: delivery.bounced,
      complained: delivery.complained,
    });

    const elapsedSeconds = campaign.started_at
      ? Math.max(1, (now.getTime() - new Date(campaign.started_at).getTime()) / 1000)
      : null;
    const rate = elapsedSeconds === null ? null : c8.sent / elapsedSeconds;

    // Zaseknutá rozesílka: kampaň se odesílá, zbývá práce, a přesto se přes minutu
    // nic nezměnilo. Hlásí se, ne opravuje: zásah patří senderu, ne obrazovce.
    //
    // Měří se poslední změna V OUTBOXU, ne `campaigns.updated_at`. Ten totiž
    // posouvá hlídač při každém tiku, takže podmínka nebyla splnitelná a hláška
    // se neukázala nikdy. Čerstvá kampaň bez jediné zprávy se za zaseknutou
    // nepovažuje: `lastChangeAt` je `null` a není od čeho měřit.
    const stalled =
      campaign.status === 'sending' &&
      c8.pending > 0 &&
      handover.lastChangeAt !== null &&
      now.getTime() - new Date(handover.lastChangeAt).getTime() > 60_000;

    return c.json(
      {
        campaign_id: campaign.id,
        status: campaign.status,
        counters: c8,
        ambiguous_count: handover.ambiguous,
        rate_per_second: rate === null ? null : Math.round(rate * 100) / 100,
        eta_seconds:
          rate === null || rate <= 0 || c8.pending === 0 ? null : Math.round(c8.pending / rate),
        stalled,
        pause_reason: campaign.pause_reason ?? null,
        undo_remaining_seconds: undoRemainingSeconds(campaign, now),
        delivery_events_seen: delivery.providerEvents > 0,
        finished: FINISHED_STATUSES.includes(campaign.status),
        // Čas POSLEDNÍ ZMĚNY PRŮBĚHU, ne řádku kampaně. Obrazovka podle něj
        // pozná, jak čerstvá čísla drží; `campaigns.updated_at` by jí říkalo
        // jen to, kdy naposled tikl hlídač.
        updated_at: handover.lastChangeAt ?? campaign.updated_at,
      },
      200,
    );
  });

  app.openapi(messagesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const q = c.req.valid('query');
    const campaign = await load(ctx, c.req.valid('param').id);
    if (!campaign.audience_built_at) {
      return c.json({ data: [], has_more: false }, 200);
    }
    const page = await listCampaignMessages(ctx, campaign.id, {
      ...(q.status === undefined ? {} : { status: q.status }),
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
      limit: q.limit,
    });
    return c.json({ data: page.rows, has_more: page.hasMore }, 200);
  });
}

/** Vystavuje se kvůli obrazovkám: potvrzovací dialog ukazuje délku okna. */
export { readWorkspaceSettings, undoWindowSeconds };
