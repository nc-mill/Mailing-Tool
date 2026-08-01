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

export type StructuredResult<T> = {
  output: T;
  usage: { inputTokens: number; outputTokens: number };
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
    finishReason: String(result.finishReason ?? 'unknown'),
  };
}

/**
 * Co z proudu konverzace vidí zbytek aplikace. Vědomě jen to, co Route
 * Handler opravdu volá.
 */
export type ConversationStream = {
  toUIMessageStreamResponse: () => Response;
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
    responseMessages: unknown;
  }) => void | Promise<void>;
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
        responseMessages: event.responseMessages,
      });
    },
  });
  return result as unknown as ConversationStream;
}
