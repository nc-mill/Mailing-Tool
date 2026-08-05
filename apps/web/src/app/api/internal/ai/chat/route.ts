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
  listBrandProfiles,
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
  mapProviderError,
  prepareConversation,
  recordUsage,
} from '@mlain/core/ai';
import {
  factories,
  generateStructured,
  isNoObjectGenerated,
  outputIssuesOf,
  streamConversation,
  toSdkTools,
} from '@mlain/core/ai/sdk';
import { problemResponseFor } from '@/lib/api/app';
import { authenticate } from '@/lib/api/authenticate';
import { getConfig, getLogger } from '@/lib/runtime';

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

/**
 * Zaloguje selhání nástroje a chybu pošle dál beze změny.
 *
 * Bez tohohle je selhání nástroje NEVIDITELNÉ: `safely` z `buildTools` ho
 * schválně převede na `{ error: <kód> }`, aby se z něj model zotavil sám, takže
 * do proudu ani do logu nedojde nic. Naměřeno klikáním 3. 8. 2026: nástroj
 * `composeTemplate` spadl, uživatel dostal jen větu od modelu, a jediná stopa
 * po chybě byla zkrácená v `ai_messages`.
 */
function loggedTool<I, O>(name: string, run: (input: I) => Promise<O>): (input: I) => Promise<O> {
  return async (input: I) => {
    try {
      return await run(input);
    } catch (error) {
      /*
       * Když chyba nenese náš kód, je to chyba od poskytovatele a musí projít
       * `mapProviderError`, jinak zůstane v logu jen bezobsažné `tool_failed`
       * a stavový kód, podle kterého se to dá dohledat, se ztratí.
       */
      const tagged = (error as { code?: string } | null)?.code;
      const mapped = tagged === undefined ? mapProviderError(error) : null;
      getLogger().error(
        {
          route: PATH,
          tool: name,
          code: tagged ?? mapped?.code ?? 'tool_failed',
          provider_status: mapped?.providerStatus ?? null,
          err_name: error instanceof Error ? error.name : 'unknown',
        },
        'ai_tool_failed',
      );
      throw error;
    }
  };
}

/**
 * Nálezy do logu: `cesta=kód`, nic víc.
 *
 * Dřív se kódy dolovaly ze zformátovaného řetězce a u nejčastější větve
 * (odpověď neprošla schématem) vycházelo prázdné pole, takže v logu stálo
 * `issue_codes: []` a příčina zůstala neznámá. Teď nálezy chodí strojově
 * z `composeTemplateDraft` a hádat se nemusí.
 *
 * Hodnoty polí se NELOGUJÍ. V nich je text e-mailu, tedy obsah uživatele.
 */
function issueCodesOf(list: readonly { path: string; code: string }[]): string[] {
  return list.map((issue) => `${issue.path}=${issue.code}`);
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
function buildComposeTool(
  ctx: WorkspaceContext,
  model: unknown,
  /**
   * Zápis spotřeby za skládání. Skládání je SAMOSTATNÉ volání modelu vedle
   * proudu konverzace, takže jeho tokeny `onFinish` níž nevidí. Dokud se
   * nezapisovaly, chyběla v přehledu spotřeby celá nejdražší část práce
   * asistenta: jeden návrh e-mailu je násobně dražší než odpověď v chatu.
   */
  recordComposeUsage: (usage: {
    inputTokens: number;
    outputTokens: number;
    /**
     * Co o skládání hlásí poskytovatel: skutečná účtovaná částka a tokeny
     * mezipaměti. U poskytovatele, který nic nehlásí, jsou tu samá `null`
     * a do databáze se v těch sloupcích nezapíše nic. Nula by z „nevíme"
     * udělala „bylo to zadarmo".
     */
    reported: {
      cost: number | null;
      cacheReadTokens: number | null;
      cacheWriteTokens: number | null;
    };
  }) => Promise<void>,
) {
  return async (raw: unknown) => {
    const input = raw as ComposeToolInput;

    const profile = await withWorkspace(ctx, async (tx) =>
      input.brandProfileId === undefined
        ? findDefaultBrandProfile(tx)
        : findBrandProfile(tx, input.brandProfileId),
    );

    /*
     * Chybějící profil zastaví skládání JEN tehdy, když si ho model vyžádal
     * jménem A projekt nějaké profily má: pak si model identifikátor vymyslel
     * a tiše složit e-mail s jinou značkou téhož projektu by bylo horší než
     * chyba.
     *
     * KDYŽ PROJEKT NEMÁ ANI JEDEN PROFIL, ŽÁDNÁ ZÁMĚNA HROZIT NEMŮŽE a skládá
     * se s neutrální výchozí paletou, přesně jako když si o profil nikdo
     * neřekne. Naměřeno klikáním 3. 8. 2026: model si na prázdné tabulce
     * vymyslel `brandProfileId: "00000000-0000-0000-0000-000000000000"`,
     * nástroj spadl na `ai_brand_profile_missing`, asistent odpověděl větou
     * „Pro vytvoření e-mailu potřebuji nejprve dostupný brand profil projektu"
     * a panel se beze slova vrátil na prázdný formulář. Extrakce značky zatím
     * nemá kompoziční kořen (viz `wiring.test.ts`), takže PRÁZDNÁ TABULKA
     * PROFILŮ JE BĚŽNÝ STAV; kdyby na ní skládání padalo, byl by asistent
     * zapojený a přesto by nikdy nic nevygeneroval, což je nález I72.
     */
    if (profile === null && input.brandProfileId !== undefined) {
      const existing = await withWorkspace(ctx, (tx) => listBrandProfiles(tx));
      if (existing.length > 0) {
        throw Object.assign(new Error('brand profile missing'), {
          code: 'ai_brand_profile_missing',
        });
      }
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
        // Konkrétní důvody neshody se schématem. Jdou do opravného kola
        // i do logu; bez nich obojí jen hádá.
        outputIssuesOf,
        buildBaseTemplate: (params) =>
          buildBaseTemplate(params as Parameters<typeof buildBaseTemplate>[0]),
        /*
         * SKLÁDÁNÍ ZASTAVÍ JEN NÁLEZ SE ZÁVAŽNOSTÍ `error`, ne varování.
         *
         * Dokud se počítala i varování, nemohl asistent uspět v projektu bez
         * značky: `buildBaseTemplate` složí neutrální paletu, ta má na dvou
         * místech nízký kontrast, validátor to hlásí jako `content_low_contrast`
         * se `severity: "warning"` a skládání na tom padalo. Naměřeno 3. 8. 2026
         * deterministicky, bez modelu: `DEFAULT_PALETTE` plus `buildBaseTemplate`
         * dá dva nálezy, oba varování, oba na barvě textu.
         *
         * Varování patří do lišty nálezů v editoru, kde je uživatel uvidí
         * a rozhodne se. Zahodit kvůli nim hotový návrh znamená nevygenerovat
         * nikdy nic, a to je horší než návrh, který si žádá doladit barvu.
         */
        validateDocument: (doc) => {
          const errors = issuesOf(doc).filter(
            (issue) => !issue.code.startsWith('liquid_') && issue.severity === 'error',
          );
          return { ok: errors.length === 0, errors };
        },
        validateLiquid: (doc) => {
          const errors = issuesOf(doc).filter(
            (issue) => issue.code.startsWith('liquid_') && issue.severity === 'error',
          );
          return { ok: errors.length === 0, errors };
        },
      },
    );

    /*
     * Zapisuje se PŘED rozhodnutím o úspěchu. Neúspěšné skládání spálí tokeny
     * v obou kolech úplně stejně jako úspěšné a poskytovatel je vyfakturuje;
     * kdyby se zapisovalo až po `if (!result.ok)`, mizela by z přehledu právě
     * ta spotřeba, která uživateli nic nepřinesla.
     */
    await recordComposeUsage(result.usage);

    if (!result.ok) {
      /*
       * Kódy nálezů z naší vlastní validace. Bez nich je `ai_invalid_output`
       * v logu slepá ulička: ví se, že to neprošlo, ale ne co konkrétně model
       * napsal špatně, a bez toho nejde ani opravit prompt, ani schéma.
       *
       * Logují se JEN kódy nálezů, ne jejich texty: v textech jsou úryvky
       * odpovědi modelu, tedy obsah e-mailu.
       */
      getLogger().error(
        {
          route: PATH,
          tool: 'compose_template',
          code: result.code,
          issue_codes: issueCodesOf(result.issueList),
        },
        'ai_compose_invalid_output',
      );
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

/**
 * KAŽDÉ selhání téhle cesty musí být v logu, ne jen chyby 5xx.
 *
 * Tenhle Hono app nemá pozorovací middleware, který `/api/v1/**` řádek
 * `msg:"request"` zapisuje, a `problemResponseFor` loguje až od stavu 500.
 * Skutečná vada tím byla neviditelná: požadavek končil na 404 z `authenticate()`
 * (chyběla hlavička `X-Workspace-Id`) a v logu po něm nezbyl jediný řádek,
 * takže se příčina hledala v adaptéru k poskytovateli.
 */
app.onError((err, c) => {
  const known = err instanceof ApiError ? err : null;
  // Syrová chyba se sem NEPÍŠE: u chyb 5xx ji pod týmž request_id zaloguje
  // `problemResponseFor` a u chyb od poskytovatele nese tělo odpovědi, které
  // může obsahovat kusy promptu. Stačí kód a stav.
  getLogger().error(
    {
      route: PATH,
      code: known?.code ?? 'internal_error',
      status: known?.status ?? 500,
      err_name: err instanceof Error ? err.name : 'unknown',
    },
    'ai_chat_failed',
  );
  return problemResponseFor(c, err);
});

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
    startBrandExtraction: loggedTool('extract_brand', async () => unavailableTool('extract_brand')),
    // Skládá se z modelu téže konverzace, ne z druhého klíče: kritérium 7b
    // platí i pro nástroje, ne jen pro hlavní odpověď.
    composeTemplate: loggedTool(
      'compose_template',
      buildComposeTool(ctx, prepared.handle.model, (usage) =>
        withWorkspace(ctx, (tx) =>
          recordUsage(
            {
              workspaceId: ctx.workspaceId,
              provider: prepared.handle.providerId,
              model: prepared.handle.modelId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              failed: false,
              day: new Date().toISOString().slice(0, 10),
              // Skládání je samostatné volání modelu, takže má i vlastní
              // účtovanou částku. Jednotku k ní přiřadí `recordUsage` podle
              // poskytovatele; tady se o měně nerozhoduje.
              reported: usage.reported,
            },
            { upsertDailyUsage: (input) => repo.upsertDailyUsage(tx, input) },
          ),
        ),
      ),
    ),
    writeCopy: loggedTool('write_copy', async () => unavailableTool('write_copy')),
    suggestSubject: loggedTool('suggest_subject', async () => unavailableTool('suggest_subject')),
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

  /*
   * DOHLEDATELNOST SELHÁNÍ. Bez tohohle skončí chyba jen v proudu ke klientovi:
   * v logu serveru po ní nezbyde nic a `ai_provider_credentials.last_error_code`
   * zůstane prázdný, takže ani obrazovka nastavení AI o problému neví a klíč
   * se tam tváří jako v pořádku.
   *
   * Do logu jde NÁŠ kód a číslo stavového kódu od poskytovatele. Tělo odpovědi
   * poskytovatele nikoliv: může nést kusy promptu nebo identifikátory účtu,
   * a `mapProviderError` ho proto do výsledku vůbec nepouští.
   */
  const codeOfFailure = (error: unknown): string => mapProviderError(error).code;

  const noteFailure = async (error: unknown): Promise<void> => {
    const mapped = mapProviderError(error);
    getLogger().error(
      {
        route: PATH,
        code: mapped.code,
        provider_status: mapped.providerStatus ?? null,
        provider: prepared.handle.providerId,
        model: prepared.handle.modelId,
        credential_id: prepared.credentialId,
        workspace_id: ctx.workspaceId,
        // Jméno a hláška chyby, NE celý objekt: ten u chyb poskytovatele nese
        // `responseBody`, a v něm mohou být kusy promptu nebo účet uživatele.
        err_name: error instanceof Error ? error.name : 'unknown',
      },
      'ai_request_failed',
    );
    try {
      await withWorkspace(ctx, (tx) =>
        repo.markCredentialError(tx, prepared.credentialId, mapped.code),
      );
      await withWorkspace(ctx, (tx) =>
        recordUsage(
          {
            workspaceId: ctx.workspaceId,
            provider: prepared.handle.providerId,
            model: prepared.handle.modelId,
            inputTokens: 0,
            outputTokens: 0,
            failed: true,
            day: new Date().toISOString().slice(0, 10),
            /*
             * U SELHÁNÍ SE ŽÁDNÁ ČÁSTKA NEVYMÝŠLÍ. Požadavek, který skončil
             * chybou, poskytovatel buď neúčtoval vůbec, nebo jeho odpověď
             * vůbec nedorazila, takže o ceně nevíme nic. Zapsat sem nulu by
             * znamenalo tvrdit „stálo to nula", což je jiné tvrzení než
             * „nevíme", a v součtu za den by to navíc přebilo NULL a udělalo
             * ze dne s chybou den s doloženou nulovou fakturou.
             */
            reported: undefined,
          },
          { upsertDailyUsage: (input) => repo.upsertDailyUsage(tx, input) },
        ),
      );
    } catch (writeError) {
      // Zápis stavu klíče nesmí přebít původní chybu. Zůstane aspoň v logu.
      getLogger().error({ route: PATH, err: writeError }, 'ai_failure_note_failed');
    }
  };

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
    onError: async (event) => {
      // Přerušení uživatelem není selhání klíče a nesmí ho označit za vadný.
      if (c.req.raw.signal.aborted) return;
      await noteFailure(event.error);
    },
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
            /*
             * Skutečná účtovaná částka a tokeny mezipaměti, sečtené přes
             * všechny kroky agentní smyčky. Vytáhl je adaptér nad AI SDK,
             * protože jen on smí sáhnout na `providerMetadata`.
             */
            reported: event.reported,
          },
          { upsertDailyUsage: (input) => repo.upsertDailyUsage(tx, input) },
        );
      });
    },
  });

  /*
   * Klientovi jde NÁŠ kód chyby, ne výchozí věta AI SDK „An error occurred.".
   * Z té panel nepozná nic a spadl by na obecnou hlášku, tedy přesně na to,
   * co tahle oprava odstraňuje.
   */
  return result.toUIMessageStreamResponse({ onError: codeOfFailure });
});

export const POST = handle(app);
