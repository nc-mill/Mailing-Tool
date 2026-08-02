import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { buildBaseTemplate } from '@mlain/emails/base';
import { ApiError } from '@mlain/core/errors/api-error';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import type { WorkspaceContext } from '@mlain/core/identity/types';
import { assertPermission } from '@mlain/core/identity/permissions';
import { withWorkspace } from '@mlain/core/tx';
import { getFieldCatalog } from '@mlain/core/contacts';
import {
  DEFAULT_PALETTE,
  DEFAULT_TYPOGRAPHY,
  findBrandProfile,
  findDefaultBrandProfile,
} from '@mlain/core/brand';
/*
 * Podcesta, ne barrel `@mlain/core/templates`. Ten reexportuje i `compile`,
 * které přes `text/emit` táhne `html-to-text` bez typů, a `tsc` webu na tom
 * padá. Validace dokumentu žádnou kompilaci nepotřebuje. Klíč
 * `"./templates/*"` je v mapě `exports` balíčku doplněný kvůli tomuhle.
 */
import { validateTemplateDocument } from '@mlain/core/templates/validate';
import {
  MAX_TOOL_STEPS,
  aiRepo as repo,
  buildModel,
  buildSystemPrompt,
  buildTools,
  collectUserUrls,
  compactToolResult,
  composeTemplateDraft,
  createMeteredFetch,
  decryptApiKey,
  prepareConversation,
  recordUsage,
} from '@mlain/core/ai';
import {
  factories,
  generateStructured,
  isNoObjectGenerated,
  streamConversation,
  toSdkTools,
} from '@mlain/core/ai/sdk';
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
 * Nástroje asistenta, jejichž výkonné části zatím nikdo nedodal (extrakce
 * značky, psaní textů, návrhy předmětu; úkoly 20 až 31 a 16 plánu P15).
 *
 * Vrací se chyba nástroje, ne vymyšlený výsledek. `buildTools` ji obalí do
 * `{ error }` a model se z ní umí zotavit; uživatel dostane odpověď, že tohle
 * ještě neumíme, místo tiše vymyšleného obsahu.
 *
 * `composeTemplate` už tady NENÍ: skládání šablony je hotové
 * (`composeTemplateDraft`) a sestavuje se níž v `buildComposeTool`.
 */
function unavailableTool(name: string): never {
  throw Object.assign(new Error(`ai tool ${name} not wired yet`), {
    code: 'ai_tool_unavailable',
  });
}

/** Vstup nástroje `compose_template` po validaci schématem `composeTemplateInput`. */
type ComposeToolInput = {
  kind: 'newsletter' | 'announcement' | 'transactional' | 'reengagement';
  brief: string;
  language: string;
  tone: 'formal' | 'friendly' | 'playful' | 'urgent';
  brandProfileId?: string;
  sectionCount?: number;
};

/**
 * ZAPOJENÍ `composeTemplateDraft`, tedy ta část, bez které byl panel asistenta
 * jen formulář bez následku. Modul byl hotový a otestovaný, jen ho nikdo
 * nevolal: nástroj `compose_template` tu vracel `ai_tool_unavailable`.
 *
 * Tohle je kompoziční kořen skládání: doména si závislosti bere parametrem,
 * skutečné implementace se dosazují právě tady a nikde jinde.
 * - `generateStructured` a `isNoObjectGenerated` z adaptéru nad AI SDK,
 * - `buildBaseTemplate` z P08, protože o barvách a struktuře nerozhoduje model,
 * - validace dokumentu a Liquidu, protože strukturovaný výstup zaručuje tvar
 *   odpovědi, ne to, že model nenapsal `{% assign %}` do textu.
 */
function buildComposeTool(ctx: WorkspaceContext, model: unknown) {
  return async (raw: unknown) => {
    const input = raw as ComposeToolInput;

    const profile = await withWorkspace(ctx, async (tx) =>
      input.brandProfileId === undefined
        ? findDefaultBrandProfile(tx)
        : findBrandProfile(tx, input.brandProfileId),
    );

    /*
     * Chybějící profil zastaví skládání JEN tehdy, když si ho model vyžádal
     * jménem: to znamená, že si identifikátor vymyslel, a tiše skládat s cizí
     * značkou by bylo horší než chyba.
     *
     * Když si o profil nikdo neřekl a projekt žádný nemá, skládá se
     * s neutrální výchozí paletou. Extrakce značky zatím nemá kompoziční kořen
     * (viz `wiring.test.ts`), takže PRÁZDNÁ TABULKA PROFILŮ JE BĚŽNÝ STAV, ne
     * výjimka. Kdyby se na ní skládání zastavilo, byl by asistent zapojený
     * a přesto by nikdy nic nevygeneroval, což je přesně nález I72.
     */
    if (profile === null && input.brandProfileId !== undefined) {
      throw Object.assign(new Error('brand profile missing'), { code: 'ai_brand_profile_missing' });
    }
    const brand = {
      palette: profile?.palette ?? DEFAULT_PALETTE,
      typography: profile?.typography ?? DEFAULT_TYPOGRAPHY,
    };
    const websiteUrl = profile?.sourceUrl ?? null;

    // Katalog polí se čte jednou a použije se v obou validacích níž.
    const fields = await getFieldCatalog(ctx);
    /*
     * Povolené obrázky jsou přesně ty, které model může znát, tedy logo
     * značky. Kdyby si UUID vymyslel, validace ho zastaví a dokument se do
     * editoru nedostane; přesně o to jde.
     */
    const logoAssetId = profile?.logoAssetId ?? null;
    const assetIds = new Set(logoAssetId === null ? [] : [logoAssetId]);
    const validateCtx = { templateKind: 'campaign' as const, fields, assetIds };

    /*
     * Validace Liquidu NENÍ druhý průchod dokumentem: `checkSemantics` z P08
     * pouští `validateLiquid` z `@mlain/contracts/liquid` nad textovými poli
     * sama, takže obě kontroly čtou tentýž výsledek a jen si z něj berou svoje
     * hlášky. Psát vlastního průchodce dokumentem by byl druhý zdroj pravdy.
     */
    const cache = new WeakMap<object, ReturnType<typeof validateTemplateDocument>>();
    const issuesOf = (doc: unknown) => {
      const key = doc as object;
      const cached = cache.get(key);
      const result = cached ?? validateTemplateDocument(doc, validateCtx);
      if (cached === undefined) cache.set(key, result);
      return result.issues;
    };

    const result = await composeTemplateDraft(
      {
        variant: input.kind,
        brief: input.brief,
        language: input.language,
        tone: input.tone,
        brand,
        model,
        ...(input.sectionCount === undefined ? {} : { sectionCount: input.sectionCount }),
        ...(websiteUrl === null ? {} : { websiteUrl }),
      },
      {
        generateStructured,
        isNoObjectGenerated,
        buildBaseTemplate: (params) =>
          buildBaseTemplate(params as Parameters<typeof buildBaseTemplate>[0]),
        validateDocument: (doc) => {
          const errors = issuesOf(doc).filter((issue) => !issue.code.startsWith('liquid_'));
          return { ok: errors.length === 0, errors };
        },
        validateLiquid: (doc) => {
          const errors = issuesOf(doc).filter((issue) => issue.code.startsWith('liquid_'));
          return { ok: errors.length === 0, errors };
        },
      },
    );

    if (!result.ok) {
      throw Object.assign(new Error('compose_template produced invalid output'), {
        code: result.code,
      });
    }

    return {
      // Návrh se zatím nikam neukládá, identifikátor slouží k odkázání
      // v konverzaci. Až vznikne tabulka návrhů, nahradí ho její klíč.
      templateDraftId: randomUUID(),
      preview: { meta: result.composition.meta, sections: result.composition.sections },
      document: result.document,
    };
  };
}

/**
 * Do `ai_messages` se výsledky nástrojů ukládají zkrácené: návrh šablony má
 * desítky kilobajtů a konverzace ho nepotřebuje, stačí shrnutí. Rozhoduje o tom
 * `compactToolResult`, ne tenhle soubor.
 *
 * `toolCallId` se dosazuje zpátky, protože ho zkracovací funkce nezná a bez něj
 * by se ve zprávě ztratila vazba na volání nástroje.
 */
function compactResponseMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return message;
    return {
      ...(message as object),
      content: content.map((part) => {
        const typed = part as {
          type?: unknown;
          toolName?: unknown;
          toolCallId?: unknown;
          output?: { value?: unknown } | undefined;
        };
        if (typed.type !== 'tool-result' || typeof typed.toolName !== 'string') return part;
        return {
          ...compactToolResult(typed.toolName, typed.output?.value),
          toolCallId: typed.toolCallId,
        };
      }),
    };
  });
}

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
    startBrandExtraction: async () => unavailableTool('extract_brand'),
    // Skládá se z modelu téže konverzace, ne z druhého klíče: kritérium 7b
    // platí i pro nástroje, ne jen pro hlavní odpověď.
    composeTemplate: buildComposeTool(ctx, prepared.handle.model),
    writeCopy: async () => unavailableTool('write_copy'),
    suggestSubject: async () => unavailableTool('suggest_subject'),
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
          parts: compactResponseMessages(event.responseMessages),
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
