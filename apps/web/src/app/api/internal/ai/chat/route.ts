import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { ApiError } from '@mlain/core/errors/api-error';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { assertPermission } from '@mlain/core/identity/permissions';
import { withWorkspace } from '@mlain/core/tx';
import {
  MAX_TOOL_STEPS,
  aiRepo as repo,
  buildModel,
  buildSystemPrompt,
  buildTools,
  collectUserUrls,
  createMeteredFetch,
  decryptApiKey,
  prepareConversation,
  recordUsage,
} from '@mlain/core/ai';
import { factories, streamConversation, toSdkTools } from '@mlain/core/ai/sdk';
import { problemResponseFor } from '@/lib/api/app';
import { authenticate } from '@/lib/api/authenticate';
import { getConfig } from '@/lib/runtime';

/**
 * `POST /api/internal/ai/chat` je záměrně MIMO veřejné API. Je to streamovaný
 * endpoint navázaný na formát AI SDK, který se mezi verzemi mění, a nechceme ho
 * verzovat jako stabilní kontrakt. Proto nemá definici v OpenAPI a nežije pod
 * `/api/v1`.
 *
 * Runtime je Node.js: potřebujeme pg, node:crypto a streamování přes undici.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATH = '/api/internal/ai/chat';

type ChatBody = {
  conversationId?: string | null;
  templateId?: string | null;
  message: { role: 'user'; parts: Array<{ type: string; text?: string }> };
  credentialId?: string | null;
  model?: string | null;
};

/**
 * Nástroje asistenta, jejichž výkonné části dodávají úkoly 10 až 17 plánu P15
 * (extrakce značky, kompozice šablony, psaní textů, návrhy předmětu). Ke dni
 * psaní žádná z nich neexistuje: `packages/core/src/brand` má zatím jen
 * validaci URL a `compose.ts` čeká na barrel `@mlain/core/templates`.
 *
 * Vrací se proto chyba nástroje, ne vymyšlený výsledek. `buildTools` ji obalí
 * do `{ error }` a model se z ní umí zotavit; uživatel dostane odpověď, že
 * tohle ještě neumíme, místo tiše vymyšleného obsahu.
 */
function unavailableTool(name: string): never {
  throw Object.assign(new Error(`ai tool ${name} not wired yet`), {
    code: 'ai_tool_unavailable',
  });
}

const toolImplementations = {
  startBrandExtraction: async () => unavailableTool('extract_brand'),
  composeTemplate: async () => unavailableTool('compose_template'),
  writeCopy: async () => unavailableTool('write_copy'),
  suggestSubject: async () => unavailableTool('suggest_subject'),
};

const app = new Hono<ApiEnv>();

app.onError((err, c) => problemResponseFor(c, err));

app.use('*', authenticate());

app.post(PATH, async (c) => {
  const config = getConfig();
  // Vypnutá funkce znamená, že endpoint v téhle instalaci NEEXISTUJE.
  // 404 je záměr: 403 by prozradila, že tu něco je a jen se to nesmí.
  if (!config.AI_ENABLED) throw new ApiError('not_found');

  const { ctx } = c.get('auth');
  assertPermission(ctx, 'ai:use');

  const body = (await c.req.json().catch(() => null)) as ChatBody | null;
  if (body === null || !Array.isArray(body.message?.parts)) {
    throw new ApiError('validation_failed', {
      errors: [{ path: 'message', code: 'invalid_value', message: 'Chybí zpráva uživatele.' }],
    });
  }

  const requestedCredentialId = body.credentialId ?? null;
  const conversationId = body.conversationId ?? null;
  const templateId = body.templateId ?? null;

  /*
   * KRITÉRIUM 7b. `prepareConversation` nejdřív načte klíč projektu a teprve
   * pak cokoliv staví. Dokud klíč není, `buildModel` se nezavolá, takže
   * nevznikne ani model, natož odchozí požadavek. Měří to
   * `no-outbound-without-key.test.ts` počítáním volání `fetch`.
   */
  const prepared = await withWorkspace(ctx, async (tx) =>
    prepareConversation(
      {
        workspaceId: ctx.workspaceId,
        templateId: templateId ?? '',
        credentialId: requestedCredentialId,
        model: body.model ?? null,
        ratePerHour: config.AI_RATE_PER_HOUR,
      },
      {
        loadCredential: (params) => repo.loadCredential(tx, params),
        decryptApiKey: (params) => decryptApiKey(params),
        buildModel: (credential, modelId) =>
          buildModel(credential, modelId, {
            // Měřený fetch: timeout, doba trvání a redakce hlaviček s klíčem.
            fetchImpl: createMeteredFetch({ timeoutMs: config.AI_REQUEST_TIMEOUT_MS }),
            factories,
            allowCustomBaseUrl: config.AI_ALLOW_CUSTOM_BASE_URL,
          }),
        countRequestsInLastHour: () => repo.countRequestsInLastHour(tx),
      },
    ),
  );

  if (!prepared.ok) {
    if (prepared.code === 'rate_limited') {
      throw new ApiError('rate_limited', {
        retryAfter: prepared.retryAfterSeconds,
        params: { limit: prepared.limit },
      });
    }
    throw new ApiError('ai_credential_missing');
  }

  const history = await withWorkspace(ctx, (tx) =>
    repo.loadConversationTurns(tx, { conversationId }),
  );

  const incomingText = body.message.parts.map((part) => part.text ?? '').join(' ');
  const userUrls = collectUserUrls([...history, { role: 'user', text: incomingText }]);

  /*
   * KRITÉRIUM 70. Z katalogu polí P07 se bere JEN definice: klíč, typ
   * a popisek. Žádná hodnota kontaktu se nečte, ani z ukázkového kontaktu.
   * `listMergeTags` si ukázky vyrábí z typu. Hlídá to `no-contact-data.test.ts`.
   */
  const fieldCatalog = await repo.loadFieldCatalog(ctx);

  const tools = buildTools({
    workspaceId: ctx.workspaceId,
    templateId: templateId ?? '',
    language: 'cs',
    userUrls,
    fieldCatalog,
    ...toolImplementations,
  });

  // Konverzace vzniká až tady: kdyby se založila dřív, zůstal by po neúspěšné
  // přípravě prázdný záznam bez jediné zprávy.
  const activeConversationId = await withWorkspace(ctx, async (tx) => {
    const id = await repo.ensureConversation(tx, {
      workspaceId: ctx.workspaceId,
      conversationId,
      templateId,
      credentialId: prepared.credentialId,
      model: prepared.handle.modelId,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
    });
    if (id === null) throw new ApiError('internal_error');
    await repo.appendMessage(tx, {
      workspaceId: ctx.workspaceId,
      conversationId: id,
      role: 'user',
      parts: body.message.parts,
    });
    return id;
  });

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user' as const, content: incomingText },
  ];

  const result = streamConversation({
    model: prepared.handle.model,
    // `WorkspaceContext` nese jen `workspaceId` a aktéra, jméno projektu ne.
    // Do promptu proto nejde; není to nic, co by asistent potřeboval.
    system: buildSystemPrompt({ language: 'cs', workspaceName: '' }),
    messages,
    tools: toSdkTools(tools),
    maxOutputTokens: config.AI_MAX_TOKENS_PER_REQUEST,
    maxRetries: 2,
    stepLimit: MAX_TOOL_STEPS,
    abortSignal: c.req.raw.signal,
    onFinish: async (event) => {
      // Rozepsaná zpráva se uloží i při přerušení, aby konverzace dávala smysl.
      const finishReason = c.req.raw.signal.aborted ? 'aborted' : event.finishReason;
      await withWorkspace(ctx, async (tx) => {
        await repo.appendMessage(tx, {
          workspaceId: ctx.workspaceId,
          conversationId: activeConversationId,
          role: 'assistant',
          parts: event.responseMessages,
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          finishReason,
        });
        await recordUsage(
          {
            workspaceId: ctx.workspaceId,
            provider: prepared.handle.providerId,
            model: prepared.handle.modelId,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            failed: false,
            day: new Date().toISOString().slice(0, 10),
          },
          { upsertDailyUsage: (input) => repo.upsertDailyUsage(tx, input) },
        );
      });
    },
  });

  return result.toUIMessageStreamResponse();
});

export const POST = handle(app);
