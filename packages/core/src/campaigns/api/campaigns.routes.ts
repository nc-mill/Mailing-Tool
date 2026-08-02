import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { problemResponse } from '../../identity/api/schemas';
import type { WorkspaceContext } from '../../tx';
import { AUDIENCE_CONFIRM_TOLERANCE } from '../constants';
import { cancelCampaign } from '../control/cancel';
import { pauseCampaign } from '../control/pause';
import { resumeCampaign } from '../control/resume';
import { EDITABLE_WHILE_SCHEDULED, validateSchedule } from '../control/schedule';
import { undoState } from '../control/undo';
import { buildPauseReason } from '../pause-reason';
import { startMaterialization } from '../repo/audience-progress';
import { transitionStatus } from '../repo/campaign';
import { MATERIALIZE_JOB } from '../jobs/materialize';
import {
  audienceState,
  parseAudience,
  runCampaignPreflight,
  EMPTY_BREAKDOWN,
} from './preflight-view';
import {
  AudiencePreviewResponse,
  CampaignResponse,
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
  ambiguousCount,
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
    audience: row.audience,
    audience_size: row.audience_size,
    audience_breakdown: row.audience_breakdown ?? null,
    audience_built_at: row.audience_built_at,
    provider_id: row.provider_id,
    sender_domain_id: row.sender_domain_id,
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
      ...body,
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
      throw new ApiError('conflict', { params: { reason: 'campaign_not_draft' } });
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

  app.openapi(progressRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'campaigns:read');
    const campaign = await load(ctx, c.req.valid('param').id);
    const now = new Date();
    const c8 = counters(campaign);
    const ambiguous = campaign.audience_built_at ? await ambiguousCount(ctx, campaign.id) : 0;

    const elapsedSeconds = campaign.started_at
      ? Math.max(1, (now.getTime() - new Date(campaign.started_at).getTime()) / 1000)
      : null;
    const rate = elapsedSeconds === null ? null : c8.sent / elapsedSeconds;

    // Zaseknutá rozesílka: kampaň se odesílá, zbývá práce, a přesto se přes minutu
    // nic nezměnilo. Hlásí se, ne opravuje: zásah patří senderu, ne obrazovce.
    const stalled =
      campaign.status === 'sending' &&
      c8.pending > 0 &&
      now.getTime() - new Date(campaign.updated_at).getTime() > 60_000;

    return c.json(
      {
        campaign_id: campaign.id,
        status: campaign.status,
        counters: c8,
        ambiguous_count: ambiguous,
        rate_per_second: rate === null ? null : Math.round(rate * 100) / 100,
        eta_seconds:
          rate === null || rate <= 0 || c8.pending === 0 ? null : Math.round(c8.pending / rate),
        stalled,
        pause_reason: campaign.pause_reason ?? null,
        undo_remaining_seconds: undoRemainingSeconds(campaign, now),
        updated_at: campaign.updated_at,
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
