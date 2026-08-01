import { composeSchema, formatZodIssues, type ComposeOutput } from './compose-schema';
import { MAX_RAW_OUTPUT_CHARS } from './conversation-service';

export type ComposeParams = {
  variant: 'newsletter' | 'announcement' | 'transactional' | 'reengagement';
  brief: string;
  language: string;
  tone: 'formal' | 'friendly' | 'playful' | 'urgent';
  brand: unknown;
  model: unknown;
  sectionCount?: number;
  websiteUrl?: string;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

export type ComposeDeps = {
  generateStructured: (params: {
    model: unknown;
    schema: typeof composeSchema;
    schemaName: string;
    schemaDescription: string;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    maxRetries: number;
    abortSignal?: AbortSignal;
  }) => Promise<{
    output: unknown;
    usage: { inputTokens: number; outputTokens: number };
    finishReason: string;
  }>;
  isNoObjectGenerated: (error: unknown) => boolean;
  buildBaseTemplate: (params: unknown) => unknown;
  validateDocument: (doc: unknown) => { ok: boolean; errors: unknown[] };
  validateLiquid: (doc: unknown) => { ok: boolean; errors: unknown[] };
};

export type ComposeResult =
  | {
      ok: true;
      document: unknown;
      composition: ComposeOutput;
      usage: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; code: 'ai_invalid_output'; rawOutput: string | null; issues: string | null };

const SCHEMA_NAME = 'EmailComposition';
const SCHEMA_DESCRIPTION = 'Obsah e-mailu rozdělený do sekcí. Nikdy negeneruj HTML.';

function buildPrompt(params: ComposeParams): string {
  const lines = [
    `Druh e-mailu: ${params.variant}.`,
    `Tón: ${params.tone}. Jazyk: ${params.language}.`,
    params.sectionCount === undefined
      ? 'Počet sekcí zvol podle zadání.'
      : `Připrav přibližně ${params.sectionCount} sekcí.`,
    params.websiteUrl === undefined ? '' : `Web zadavatele: ${params.websiteUrl}.`,
    '',
    'Zadání od uživatele:',
    params.brief,
  ];
  return lines.filter((line) => line !== '').join('\n');
}

/**
 * Jeden pokus, jedna oprava, pak se vzdáme bez poškození. Nikdy se nedělá
 * částečné použití odpovědi, dohadování chybějících polí ani zápis nevalidního
 * dokumentu s tím, že „uživatel to opraví". Editor se nikdy neotevře s rozbitým
 * dokumentem.
 */
export async function composeTemplateDraft(
  params: ComposeParams,
  deps: ComposeDeps,
): Promise<ComposeResult> {
  const system = SCHEMA_DESCRIPTION;
  const basePrompt = buildPrompt(params);
  const maxOutputTokens = params.maxOutputTokens ?? 16_000;

  const attempt = async (prompt: string) =>
    deps.generateStructured({
      model: params.model,
      schema: composeSchema,
      schemaName: SCHEMA_NAME,
      schemaDescription: SCHEMA_DESCRIPTION,
      system,
      prompt,
      maxOutputTokens,
      // maxRetries řeší jen síťové chyby, ne neshodu se schématem: SDK
      // opakuje stejný požadavek, což nevalidní schéma neopraví.
      maxRetries: 2,
      ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
    });

  let rawOutput: string | null = null;
  let issues: string | null = null;
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (let round = 0; round < 2; round += 1) {
    let candidate: unknown;
    try {
      const prompt =
        round === 0
          ? basePrompt
          : [
              basePrompt,
              '',
              'Tvoje předchozí odpověď neprošla validací. Tady je, co jsi vrátil:',
              (rawOutput ?? '').slice(0, MAX_RAW_OUTPUT_CHARS),
              '',
              'Konkrétní chyby:',
              issues ?? '(neuvedeno)',
              '',
              'Oprav je a vrať znovu celou odpověď podle schématu.',
            ].join('\n');
      const response = await attempt(prompt);
      usage = response.usage;
      candidate = response.output;
    } catch (error) {
      if (!deps.isNoObjectGenerated(error)) throw error;
      const typed = error as { text?: string };
      rawOutput = typed.text ?? null;
      issues = 'Odpověď nešla naparsovat jako JSON nebo neodpovídala schématu.';
      continue;
    }

    const parsed = composeSchema.safeParse(candidate);
    if (!parsed.success) {
      rawOutput = JSON.stringify(candidate).slice(0, MAX_RAW_OUTPUT_CHARS);
      issues = formatZodIssues(parsed.error);
      continue;
    }

    const document = deps.buildBaseTemplate({
      variant: params.variant,
      brand: params.brand,
      language: params.language,
      sections: parsed.data.sections,
      websiteUrl: params.websiteUrl,
      darkMode: true,
    });

    // Structured output zaručuje tvar, ne to, že model nenapsal do textu
    // {% assign %}. Proto se výsledek vždy validuje ještě jednou naším
    // validátorem, i když ho postavil náš vlastní generátor.
    const documentCheck = deps.validateDocument(document);
    const liquidCheck = deps.validateLiquid(document);
    if (!documentCheck.ok || !liquidCheck.ok) {
      rawOutput = JSON.stringify(candidate).slice(0, MAX_RAW_OUTPUT_CHARS);
      issues = JSON.stringify([...documentCheck.errors, ...liquidCheck.errors]).slice(0, 2000);
      continue;
    }

    return { ok: true, document, composition: parsed.data, usage };
  }

  return { ok: false, code: 'ai_invalid_output', rawOutput, issues };
}
