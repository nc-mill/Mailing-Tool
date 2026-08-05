import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
  isStepCount,
  streamText,
  tool,
} from 'ai';
import type { ToolSet } from 'ai';
import type { z } from 'zod';

export { factories } from './factories';

/**
 * ADAPTÉR NAD AI SDK. Jediný adresář v repozitáři, který smí importovat `ai`
 * a `@ai-sdk/*`; hlídá to `boundary.test.ts`. Změna verze balíčku je tím
 * změnou jednoho adresáře, ne rozsypaná po aplikaci (3.12.2a).
 *
 * Tvary volání jsou ověřené proti NAINSTALOVANÉ verzi (ai 7.0.47), ne podle
 * paměti ani doslovným opisem plánu. Co se proti plánu opravilo, je popsané
 * u jednotlivých funkcí.
 */

/** `tool()` z `ai` v7. Vstup se popisuje polem `inputSchema`, ne `parameters`. */
export const defineTool = tool;

/**
 * Převede doménové definice nástrojů na sadu, které rozumí SDK.
 *
 * Obalení helperem `tool()` se dělá TADY, ne v doméně. Kdyby ho volala doména,
 * prosákly by typy SDK do veřejné deklarační plochy `@mlain/core` a `tsc`
 * s `declaration: true` by to odmítl jako nepřenositelné (TS2742). Doména tak
 * zůstává na SDK nezávislá i v typech, nejen v importech.
 */
export function toSdkTools(definitions: Record<string, unknown>): ToolSet {
  const entries = Object.entries(definitions).map(([name, definition]) => [
    name,
    tool(definition as Parameters<typeof tool>[0]),
  ]);
  return Object.fromEntries(entries) as ToolSet;
}

/**
 * Strop kroků agentní smyčky. V typech se pomůcka jmenuje `isStepCount`,
 * `stepCountIs` je jen její alias na tomtéž objektu.
 */
export const stopAfterSteps = isStepCount;

/**
 * OPRAVA PROTI PLÁNU. Plán se ptal jen na `NoObjectGeneratedError`, jenže ten
 * patří k zavrženému `generateObject`. `generateText` s nastavením `output`
 * hlásí chybějící nebo nevalidní výstup jako `NoOutputGeneratedError`. Kdyby
 * se ptalo jen na první z nich, opravný pokus v `compose.ts` by se nikdy
 * nespustil a chyba by probublala ven jako neošetřená výjimka.
 */
export function isNoObjectGenerated(error: unknown): error is {
  text?: string;
  cause?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  finishReason?: string;
} {
  return NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error);
}

/** Jeden konkrétní důvod, proč odpověď modelu neprošla schématem. */
export type OutputIssue = { path: string; code: string; message: string };

/**
 * Vytáhne z chyby SDK KONKRÉTNÍ důvody, proč výstup neprošel schématem.
 *
 * Proč to musí být tady: chybu balí AI SDK do tří vrstev
 * (`AI_NoObjectGeneratedError` → `AI_TypeValidationError` → `ZodError`) a sáhnout
 * do nich smí jen tenhle adaptér. Bez toho zbyla doméně jen věta „odpověď
 * neodpovídala schématu", kterou nešlo poslat modelu k opravě ani zapsat do logu.
 * Naměřeno 3. 8. 2026: opravné kolo dostávalo obecnou větu, takže druhý pokus
 * opravoval naslepo a jen spotřeboval tokeny.
 *
 * Vrací JEN cestu, kód a hlášku validace. Hodnoty polí ne: v těch je text
 * e-mailu, tedy obsah, který do logu nepatří.
 */
export function outputIssuesOf(error: unknown): OutputIssue[] {
  for (let current: unknown = error, depth = 0; current !== null && depth < 6; depth += 1) {
    if (typeof current !== 'object') break;
    const candidate = current as { issues?: unknown; cause?: unknown };
    if (Array.isArray(candidate.issues)) {
      return candidate.issues.map((raw) => {
        const issue = raw as { path?: unknown; code?: unknown; message?: unknown };
        const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
        return {
          path: path === '' ? '(kořen)' : path,
          code: typeof issue.code === 'string' ? issue.code : 'invalid',
          message: typeof issue.message === 'string' ? issue.message : '',
        };
      });
    }
    current = candidate.cause;
  }
  return [];
}

/**
 * Co o volání hlásí sám poskytovatel, vytažené z `providerMetadata`.
 *
 * Tvar je NÁŠ, ne SDK: doména nesmí vidět typy z `ai` ani z `@ai-sdk/*`
 * (hlídá `boundary.test.ts`), takže překlad patří sem. `null` všude znamená
 * „nehlásil", nikdy nulu.
 */
export type ReportedUsage = {
  /** Skutečná účtovaná částka. Jednotku k ní přidává katalog, ne tenhle modul. */
  cost: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export const NO_REPORTED_USAGE: ReportedUsage = {
  cost: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
};

/**
 * Skutečná cena z odpovědi OpenRouteru.
 *
 * PROČ SE SČÍTÁ PŘES KROKY, ne bere z posledního. Konverzace s nástroji je
 * agentní smyčka: každý krok je samostatné volání chat completions a každé
 * z nich má vlastní `usage.cost`. `event.providerMetadata` na události konce
 * je podle typů SDK metadata POSLEDNÍHO kroku (a je označené `@deprecated`),
 * takže by se z pěti účtovaných volání zapsalo jedno. Tokeny SDK sčítá samo,
 * u ceny to musí udělat tenhle adaptér.
 *
 * Ověřeno 3. 8. 2026 proti nainstalovanému `@openrouter/ai-sdk-provider` 3.0.0,
 * ne podle paměti: `doGenerate` i `doStream` skládají
 * `providerMetadata.openrouter.usage` a pole `cost` do něj kopírují přímo
 * z `response.usage.cost`, pokud ho odpověď nese. U streamu se metadata
 * vydávají v části `finish`, tedy v poslední zprávě proudu.
 *
 * Cizí providery tu nevadí: kdo `openrouter` v metadatech nemá, vrátí `null`
 * a nic se neuloží.
 */
function openRouterUsageOf(step: unknown): Record<string, unknown> | null {
  const metadata = (step as { providerMetadata?: unknown } | null)?.providerMetadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const openrouter = (metadata as { openrouter?: unknown }).openrouter;
  if (typeof openrouter !== 'object' || openrouter === null) return null;
  const usage = (openrouter as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  return usage as Record<string, unknown>;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Součet hlášené ceny přes všechny kroky plus tokeny mezipaměti z agregované
 * spotřeby SDK.
 *
 * Tokeny mezipaměti se berou z `usage.inputTokenDetails`, protože to je
 * SPOLEČNÉ pole `LanguageModelUsage` napříč providery (ověřeno v typech `ai`
 * 7.0.47), kdežto cena je pole jediného providera. Kdo přidá druhého
 * poskytovatele s hlášenou cenou, dopíše sem druhou větev; tokeny mezipaměti
 * začnou chodit samy.
 *
 * EXPORTOVANÉ SCHVÁLNĚ. Je to jediná logika v adaptéru, která něco POČÍTÁ,
 * a spočítat ji špatně znamená ukázat uživateli cizí částku. Test ji musí umět
 * spustit bez živého poskytovatele, jinak by se ověřovala až fakturou.
 */
export function reportedUsageOf(params: { steps: unknown; usage: unknown }): ReportedUsage {
  let cost: number | null = null;
  if (Array.isArray(params.steps)) {
    for (const step of params.steps) {
      const stepCost = finiteOrNull(openRouterUsageOf(step)?.['cost']);
      if (stepCost !== null) cost = (cost ?? 0) + stepCost;
    }
  }

  const details = (params.usage as { inputTokenDetails?: unknown } | null)?.inputTokenDetails as
    { cacheReadTokens?: unknown; cacheWriteTokens?: unknown } | undefined;

  return {
    cost,
    cacheReadTokens: finiteOrNull(details?.cacheReadTokens),
    cacheWriteTokens: finiteOrNull(details?.cacheWriteTokens),
  };
}

export type StructuredResult<T> = {
  output: T;
  usage: { inputTokens: number; outputTokens: number };
  /** Co o volání hlásí poskytovatel. U většiny z nich samé `null`. */
  reported: ReportedUsage;
  finishReason: string;
};

/**
 * Strukturovaný výstup. `generateObject` nese v nainstalované verzi doslova
 * `@deprecated Use generateText with an output setting instead`, proto tahle
 * cesta. Závazné je, že výstup je validovaný schématem; konkrétní volání je
 * dobový snímek (3.12.2a).
 */
export async function generateStructured<T>(params: {
  model: unknown;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaDescription: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  maxRetries: number;
  abortSignal?: AbortSignal;
}): Promise<StructuredResult<T>> {
  const result = await generateText({
    model: params.model as never,
    /*
     * `strictJsonSchema: false` NENÍ změkčení kontroly, je to podmínka toho, aby
     * skládání šablony vůbec někdy proběhlo.
     *
     * Přísný režim strukturovaného výstupu u OpenAI přijímá jen podmnožinu JSON
     * Schema: zakazuje `oneOf` a vyžaduje, aby každý klíč objektu byl v poli
     * `required`, tedy žádná volitelná pole. Naše schéma sekcí z P08 je
     * rozlišená unie (`oneOf`) s volitelnými poli, takže požadavek skončil na
     * 400 dřív, než se model vůbec zeptali. Naměřeno doslova 3. 8. 2026:
     *
     *   Invalid schema for response_format 'email_composition':
     *   In context=('properties','sections','items'), 'oneOf' is not permitted.
     *   ... 'required' is required to be supplied and to be an array including
     *   every key in properties. Missing 'subhead'.
     *
     * Schéma se kvůli tomu NEPŘEPISUJE: bylo by to druhý zdroj pravdy vedle
     * P08 (nález N62) a rozešlo by se s ním. V nepřísném režimu je schéma pro
     * model vodítkem a závaznou kontrolou zůstává `safeParse` v `compose.ts`,
     * který při neshodě pošle modelu konkrétní chyby a nechá ho odpověď opravit.
     * Tvar výstupu tedy pořád zaručuje naše validace, jen ne parser providera.
     *
     * Klíč `openai` je jmenný prostor providera: ostatní provideři volbu
     * ignorují, takže tenhle řádek nikomu jinému nic nemění.
     */
    providerOptions: { openai: { strictJsonSchema: false } },
    output: Output.object({
      schema: params.schema,
      name: params.schemaName,
      description: params.schemaDescription,
    }),
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    // `exactOptionalPropertyTypes` nedovolí předat `abortSignal: undefined`.
    ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
  });

  return {
    output: result.output as T,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
    reported: reportedUsageOf({ steps: result.steps, usage: result.usage }),
    finishReason: String(result.finishReason ?? 'unknown'),
  };
}

/**
 * Co z proudu konverzace vidí zbytek aplikace. Vědomě jen to, co Route
 * Handler opravdu volá.
 */
export type ConversationStream = {
  /**
   * `onError` NENÍ volitelný detail. Bez něj vloží AI SDK do proudu svůj
   * výchozí text „An error occurred." (viz `createUIMessageStream` v `ai`),
   * ze kterého klient nepozná vůbec nic a spadne na obecnou hlášku. Volající
   * sem vrací NÁŠ kód chyby, aby ho panel uměl pojmenovat.
   */
  toUIMessageStreamResponse: (options?: { onError?: (error: unknown) => string }) => Response;
};

export type StreamConversationParams = {
  model: unknown;
  system: string;
  messages: unknown;
  /**
   * `ToolSet`, ne `Record<string, unknown>`. S obecným záznamem odvodí
   * `streamText` parametr TOOLS jako `never` a pak po volajícím chce
   * `toolsContext`, což je jen následek špatného odvození, ne skutečný
   * požadavek.
   */
  tools: ToolSet;
  maxOutputTokens: number;
  maxRetries: number;
  /** Strop kroků smyčky. Nejde o zrušenou volbu SDK `maxSteps`, je to náš parametr. */
  stepLimit: number;
  abortSignal?: AbortSignal;
  onFinish?: (event: {
    finishReason: string;
    usage: { inputTokens: number; outputTokens: number };
    /** Skutečná cena a mezipaměť od poskytovatele, sečtené přes všechny kroky. */
    reported: ReportedUsage;
    responseMessages: unknown;
  }) => void | Promise<void>;
  /**
   * Selhání kdekoliv v proudu. Volá se i tehdy, když už část odpovědi odešla,
   * takže je to jediné místo, kde jde chybu zapsat do logu a ke klíči.
   */
  onError?: (event: { error: unknown }) => void | Promise<void>;
};

/**
 * Streamovaná konverzace. Odpověď je UI Message Stream z AI SDK.
 *
 * Návratový typ je vypsaný a ÚZKÝ schválně, ze dvou důvodů. Odvozený tvar
 * odkazuje na typy `Output` a `Context` z balíčku `ai`, které se z našeho
 * balíčku nedají pojmenovat, takže `tsc` s `declaration: true` odvození
 * odmítne (TS4058). A i kdyby šlo, protáhlo by typy SDK do veřejné deklarační
 * plochy `@mlain/core`, což je přesně to, čemu má adaptér bránit.
 *
 * Volající potřebuje jedinou věc: udělat z proudu odpověď. Až bude potřeba
 * víc, je to aditivní změna tohohle jednoho souboru.
 */
export function streamConversation(params: StreamConversationParams): ConversationStream {
  const result = streamText({
    model: params.model as never,
    system: params.system,
    messages: params.messages as never,
    tools: params.tools,
    toolChoice: 'auto',
    // OPRAVA PROTI PLÁNU: plán tu sahal na `params.maxSteps`, což je parametr,
    // který na téhle funkci neexistuje. Správně je `stepLimit`.
    stopWhen: isStepCount(params.stepLimit),
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
    onError: async (event) => {
      await params.onError?.({ error: event.error });
    },
    onFinish: async (event) => {
      // OPRAVA PROTI PLÁNU: zprávy odpovědi jsou na události přímo jako
      // `responseMessages`. Tvar `event.response.messages`, který má plán,
      // v nainstalované verzi nese jen POSLEDNÍ krok a je označený
      // `@deprecated`; ve smyčce s nástroji by se uložil zlomek konverzace.
      //
      // `event.usage` je naopak správně: v `GenerateTextEndEvent` je to součet
      // přes všechny kroky, `totalUsage` je jen jeho zavržený alias.
      await params.onFinish?.({
        finishReason: String(event.finishReason ?? 'unknown'),
        usage: {
          inputTokens: event.usage?.inputTokens ?? 0,
          outputTokens: event.usage?.outputTokens ?? 0,
        },
        // `event.steps`, ne `event.providerMetadata`: to druhé je metadata
        // POSLEDNÍHO kroku, takže by se ze smyčky s nástroji zapsala cena
        // jediného z několika účtovaných volání. Vysvětlení u `reportedUsageOf`.
        reported: reportedUsageOf({ steps: event.steps, usage: event.usage }),
        responseMessages: event.responseMessages,
      });
    },
  });
  return result as unknown as ConversationStream;
}
