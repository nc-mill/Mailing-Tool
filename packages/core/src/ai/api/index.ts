import { OpenAPIHono, createRoute, z, type Hook } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { actorInfo } from '../../identity/types';
import { writeAuditLog } from '../../audit/write';
import { assertPermission } from '../../identity/permissions';
import { AI_AUDIT } from '../audit';
import { problemResponse, type ApiEnv } from '../../identity/api/schemas';
import { loadConfig } from '../../config/index';
import { withWorkspace } from '../../tx';
import { CATALOG_UPDATED_AT, PRICING_UPDATED_AT } from '../catalog';
import { decryptApiKey } from '../credential-service';
import { mapProviderError } from '../error-map';
import { createMeteredFetch } from '../metered-fetch';
import { probeProviderModels } from '../probe';
import { providerIdSchema, type ProviderId } from '../providers';
import { buildUsageReport } from '../usage';
import * as repo from '../repo';
import {
  createCredentialBody,
  handleCreateCredential,
  handleDeleteCredential,
  handleListCredentials,
  handleSetDefaultCredential,
  handleTestCredential,
} from './credentials.routes';
import { handleListModels, listModelsRoute } from './models.routes';
import { usageRoute } from './usage.routes';
import {
  deleteConversationRoute,
  getConversationRoute,
  listConversationsRoute,
} from './conversations.routes';

/**
 * Prostředí route souborů domény AI. Týž důvod jako u kontaktů a segmentů:
 * autentizační middleware P04 plní proměnnou `auth` tvaru `{ ctx, label }`,
 * takže vlastní typ prostředí by znamenal `undefined` za běhu.
 */
export type AiEnv = ApiEnv;

export const validationHook: Hook<unknown, AiEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((p) => String(p)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const aiApi = new OpenAPIHono<AiEnv>({ defaultHook: validationHook });

const TAG = 'AI';

/*
 * ODCHYLKA OD PLÁNU. `credentials.routes.ts` má jen handlery, žádnou definici
 * cesty; ostatní tři soubory naopak mají definice, ale žádné handlery.
 * Definice pro credentials proto vznikají tady, u místa, kde se registrují,
 * aby se do souborů, které souběžně píše někdo jiný, nesahalo.
 */

const credentialResponse = z
  .object({
    id: z.string().uuid(),
    provider: providerIdSchema,
    label: z.string(),
    key_hint: z.string(),
    base_url: z.string().nullable(),
    default_model: z.string(),
    default_credential: z.boolean(),
    last_used_at: z.string().nullable(),
    last_error_at: z.string().nullable(),
    last_error_code: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('AiCredential');

const listCredentialsRoute = createRoute({
  method: 'get',
  path: '/ai/credentials',
  tags: [TAG],
  summary: 'Klíče poskytovatelů AI',
  description:
    'Hodnota klíče se nevrací nikdy, ani redigovaná. Ven jde jen nápověda o posledních čtyřech znacích.',
  security: [{ bearerAuth: ['ai:configure'] }],
  responses: {
    200: {
      description: 'Seznam klíčů projektu',
      content: { 'application/json': { schema: z.object({ data: z.array(credentialResponse) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
  },
});

const createCredentialRoute = createRoute({
  method: 'post',
  path: '/ai/credentials',
  tags: [TAG],
  summary: 'Uložení klíče poskytovatele',
  description: 'Klíč se ukládá zašifrovaný obálkou enc:v1. Do auditu se zapíše bez jeho hodnoty.',
  security: [{ bearerAuth: ['ai:configure'] }],
  request: { body: { content: { 'application/json': { schema: createCredentialBody } } } },
  responses: {
    201: {
      description: 'Klíč uložen',
      content: { 'application/json': { schema: z.object({ id: z.string().uuid() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    409: problemResponse('already_exists'),
    422: problemResponse('validation_failed'),
  },
});

const deleteCredentialRoute = createRoute({
  method: 'delete',
  path: '/ai/credentials/{credential_id}',
  tags: [TAG],
  summary: 'Smazání klíče poskytovatele',
  description:
    'Klíč se maže natrvalo. Dřívější konverzace, které ho použily, zůstávají, jen ztratí použitelný klíč pro další zprávu.',
  security: [{ bearerAuth: ['ai:configure'] }],
  request: { params: z.object({ credential_id: z.string().uuid() }) },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const setDefaultCredentialRoute = createRoute({
  method: 'post',
  path: '/ai/credentials/{credential_id}/default',
  tags: [TAG],
  summary: 'Nastavení výchozího klíče',
  description: 'Výchozí klíč se použije, když konverzace nevybere konkrétní credential_id.',
  security: [{ bearerAuth: ['ai:configure'] }],
  request: { params: z.object({ credential_id: z.string().uuid() }) },
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

const testCredentialRoute = createRoute({
  method: 'post',
  path: '/ai/credentials/{credential_id}/test',
  tags: [TAG],
  summary: 'Zkouška klíče',
  description:
    'Zkouší se seznamem modelů, ne generováním textu: ověření klíče nesmí stát peníze. Odpověď poskytovatele se ven nikdy nepředává, jen přeložitelný kód.',
  security: [{ bearerAuth: ['ai:configure'] }],
  request: { params: z.object({ credential_id: z.string().uuid() }) },
  responses: {
    200: {
      description: 'Výsledek zkoušky',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            models: z.array(z.string()).optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/** Rozšifruje klíč a sáhne s ním na providera. Vždy přes měřený fetch. */
async function probeCredential(
  workspaceId: string,
  credential: repo.StoredCredential,
): Promise<string[]> {
  const config = loadConfig();
  return probeProviderModels(
    {
      provider: credential.provider,
      apiKey: decryptApiKey({ workspaceId, stored: credential.stored }),
      baseUrl: credential.baseUrl,
    },
    { fetchImpl: createMeteredFetch({ timeoutMs: config.AI_REQUEST_TIMEOUT_MS }) },
  );
}

export function registerAiRoutes(app: OpenAPIHono<AiEnv>): void {
  app.openapi(listCredentialsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:configure');
    const result = await withWorkspace(ctx, async (tx) =>
      handleListCredentials(
        { workspaceId: ctx.workspaceId, actorId: actorIdOf(ctx) },
        { listCredentials: () => repo.listCredentials(tx) },
      ),
    );
    return c.json(result.body, 200);
  });

  app.openapi(createCredentialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:configure');
    const body = c.req.valid('json');

    const { label } = c.get('auth');
    const result = await withWorkspace(ctx, (tx) =>
      handleCreateCredential({ workspaceId: ctx.workspaceId, actorId: actorIdOf(ctx) }, body, {
        insertCredential: (row) => repo.insertCredential(tx, row),
        findByFingerprint: (params) => repo.findCredentialByFingerprint(tx, params),
        // Audit se zapisuje v TÉŽE transakci jako uložení klíče (3.7): když se
        // vloha rollbackne, nesmí po ní zůstat záznam o události, která nenastala.
        writeAuditLog: (entry) =>
          writeAuditLog(tx, {
            action: AI_AUDIT['ai_credential.created'],
            workspaceId: ctx.workspaceId,
            actor: actorInfo(ctx.actor, label),
            targetType: 'ai_provider_credential',
            targetId: String(entry['targetId'] ?? ''),
            metadata: (entry['metadata'] ?? {}) as Record<string, unknown>,
          }),
      }),
    );

    if (result.status === 409) throw new ApiError('already_exists', { params: result.params });
    if (result.status === 422) {
      throw new ApiError('validation_failed', {
        errors: result.errors.map((issue) => ({
          path: String((issue as { path?: unknown }).path ?? ''),
          code: String((issue as { code?: unknown }).code ?? 'invalid_value'),
          message: String((issue as { message?: unknown }).message ?? ''),
        })),
      });
    }
    return c.json(result.body, 201);
  });

  app.openapi(deleteCredentialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:configure');
    const { credential_id: credentialId } = c.req.valid('param');
    const { label } = c.get('auth');

    const result = await withWorkspace(ctx, (tx) =>
      handleDeleteCredential(
        { workspaceId: ctx.workspaceId, actorId: actorIdOf(ctx) },
        { credentialId },
        {
          deleteCredential: (params) => repo.deleteCredential(tx, params.credentialId),
          writeAuditLog: (entry) =>
            writeAuditLog(tx, {
              action: AI_AUDIT['ai_credential.deleted'],
              workspaceId: ctx.workspaceId,
              actor: actorInfo(ctx.actor, label),
              targetType: 'ai_provider_credential',
              targetId: String(entry['targetId'] ?? ''),
              metadata: (entry['metadata'] ?? {}) as Record<string, unknown>,
            }),
        },
      ),
    );

    if (result.status === 404) throw new ApiError('not_found');
    return c.body(null, 204);
  });

  app.openapi(setDefaultCredentialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:configure');
    const { credential_id: credentialId } = c.req.valid('param');
    const { label } = c.get('auth');

    const result = await withWorkspace(ctx, (tx) =>
      handleSetDefaultCredential(
        { workspaceId: ctx.workspaceId, actorId: actorIdOf(ctx) },
        { credentialId },
        {
          setDefaultCredential: (params) => repo.setDefaultCredential(tx, params.credentialId),
          writeAuditLog: (entry) =>
            writeAuditLog(tx, {
              action: AI_AUDIT['ai_credential.default_changed'],
              workspaceId: ctx.workspaceId,
              actor: actorInfo(ctx.actor, label),
              targetType: 'ai_provider_credential',
              targetId: String(entry['targetId'] ?? ''),
              metadata: (entry['metadata'] ?? {}) as Record<string, unknown>,
            }),
        },
      ),
    );

    if (result.status === 404) throw new ApiError('not_found');
    return c.json(result.body, 200);
  });

  app.openapi(testCredentialRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:configure');
    const { credential_id: credentialId } = c.req.valid('param');

    const credential = await withWorkspace(ctx, (tx) => repo.loadCredential(tx, { credentialId }));
    if (credential === null) throw new ApiError('not_found');

    const result = await handleTestCredential(
      { workspaceId: ctx.workspaceId, actorId: actorIdOf(ctx) },
      { credentialId },
      {
        probe: async () => ({ models: await probeCredential(ctx.workspaceId, credential) }),
        markCredentialOk: (params) =>
          withWorkspace(ctx, (tx) => repo.markCredentialOk(tx, params.credentialId)),
        markCredentialError: (params) =>
          withWorkspace(ctx, (tx) =>
            repo.markCredentialError(tx, params.credentialId, params.code),
          ),
      },
    );

    return c.json(
      result.ok ? { ok: true, models: result.models } : { ok: false, error: result.error },
      200,
    );
  });

  app.openapi(listModelsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:use');
    const { credential_id: credentialId } = c.req.valid('query');

    const credential = await withWorkspace(ctx, (tx) =>
      repo.loadCredential(tx, { credentialId: credentialId ?? null }),
    );
    // Bez klíče projektu se nabízí jen kurátorovaný katalog. Na providera se
    // nesahá, protože není čím se autentizovat (kritérium 7b).
    const provider: ProviderId = credential?.provider ?? 'anthropic';

    const result = await handleListModels(
      { provider, credentialId: credential === null ? null : credential.id },
      {
        // Bez klíče se sem `handleListModels` nedostane (předává se
        // `credentialId: null`). Kdyby se tahle podmínka někdy rozvolnila,
        // zůstane pojistka tady: raději výjimka než požadavek bez klíče.
        fetchProviderModels: () => {
          if (credential === null) throw new ApiError('ai_credential_missing');
          return probeCredential(ctx.workspaceId, credential);
        },
      },
    );

    return c.json({ ...result, catalog_updated_at: CATALOG_UPDATED_AT }, 200);
  });

  app.openapi(usageRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:use');
    const { from, to } = c.req.valid('query');
    const rows = await withWorkspace(ctx, (tx) => repo.loadUsageRows(tx, { from, to }));
    const report = buildUsageReport(rows);
    return c.json(
      {
        totals: {
          requests: report.totals.requests,
          input_tokens: report.totals.inputTokens,
          output_tokens: report.totals.outputTokens,
          errors: report.totals.errors,
        },
        by_model: report.byModel.map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          requests: entry.requests,
          input_tokens: entry.inputTokens,
          output_tokens: entry.outputTokens,
          errors: entry.errors,
          estimated_cost_usd: entry.estimatedCostUsd,
          input_cost_usd: entry.inputCostUsd,
          output_cost_usd: entry.outputCostUsd,
          reported_cost: entry.reportedCost,
          reported_cost_unit: entry.reportedCostUnit,
          cache_read_tokens: entry.cacheReadTokens,
          cache_write_tokens: entry.cacheWriteTokens,
          price_status: entry.priceStatus,
          long_context_threshold_tokens: entry.longContextThresholdTokens,
        })),
        by_day: report.byDay.map((entry) => ({
          day: entry.day,
          requests: entry.requests,
          input_tokens: entry.inputTokens,
          output_tokens: entry.outputTokens,
          errors: entry.errors,
          estimated_cost_usd: entry.estimatedCostUsd,
          input_cost_usd: entry.inputCostUsd,
          output_cost_usd: entry.outputCostUsd,
          reported_cost: entry.reportedCost,
          reported_cost_unit: entry.reportedCostUnit,
        })),
        estimated_cost_usd: report.estimatedCostUsd,
        input_cost_usd: report.inputCostUsd,
        output_cost_usd: report.outputCostUsd,
        reported_cost: report.reportedCost,
        reported_cost_unit: report.reportedCostUnit,
        has_long_context_caveat: report.hasLongContextCaveat,
        pricing_updated_at: PRICING_UPDATED_AT,
      },
      200,
    );
  });

  app.openapi(listConversationsRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:use');
    const { template_id: templateId, limit } = c.req.valid('query');
    const rows = await withWorkspace(ctx, (tx) =>
      repo.listConversations(tx, { templateId, limit }),
    );
    return c.json({ data: rows.map(presentConversation), next_cursor: null }, 200);
  });

  app.openapi(getConversationRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:use');
    const { conversation_id: conversationId } = c.req.valid('param');
    const found = await withWorkspace(ctx, (tx) => repo.getConversation(tx, conversationId));
    if (found === null) throw new ApiError('not_found');
    return c.json(
      {
        ...presentConversation(found),
        messages: found.messages.map((message) => ({
          id: message.id,
          seq: message.seq,
          role: message.role,
          parts: message.parts,
          input_tokens: message.inputTokens,
          output_tokens: message.outputTokens,
          finish_reason: message.finishReason,
          error_code: message.errorCode,
          created_at: message.createdAt.toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(deleteConversationRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'ai:use');
    const { conversation_id: conversationId } = c.req.valid('param');
    const deleted = await withWorkspace(ctx, (tx) => repo.deleteConversation(tx, conversationId));
    if (!deleted) throw new ApiError('not_found');
    return c.body(null, 204);
  });
}

function presentConversation(row: repo.ConversationSummaryRow) {
  return {
    id: row.id,
    template_id: row.templateId,
    title: row.title,
    model: row.model,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Audit chce identifikátor aktéra. U klíče je jím klíč sám. */
function actorIdOf(ctx: { actor: { type: string; userId?: string; apiKeyId?: string } }): string {
  return ctx.actor.userId ?? ctx.actor.apiKeyId ?? '';
}

registerAiRoutes(aiApi);

/**
 * Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, protože definice
 * cest píšou adresy relativně (`/ai/models`), jak je má plán.
 */
export function registerAiApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', aiApi);
}

export { mapProviderError };
