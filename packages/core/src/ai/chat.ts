import type { NonEmptyApiKey, ProviderHandle } from './build-model';
import { buildSystemPrompt } from './prompt';
import type { ProviderId } from './providers';
import { collectUserUrls, type ConversationTurn } from './tools/context';
import { buildTools, type AssistantTools, type ToolContext } from './tools/index';
import type { MergeTagCatalog } from './tools/list-merge-tags';

/** Osm kroků stačí na „zjisti tagy, stáhni značku, poskládej šablonu, oprav text" a zastropuje náklady. */
export const MAX_TOOL_STEPS = 8;

export type PrepareParams = {
  workspaceId: string;
  templateId: string;
  credentialId: string | null;
  model: string | null;
  ratePerHour: number;
};

export type PrepareDeps = {
  loadCredential: (params: { workspaceId: string; credentialId: string | null }) => Promise<{
    id: string;
    provider: ProviderId;
    stored: string;
    defaultModel: string;
    baseUrl: string | null;
  } | null>;
  decryptApiKey: (params: { workspaceId: string; stored: string }) => NonEmptyApiKey;
  buildModel: (
    credential: { provider: ProviderId; apiKey: NonEmptyApiKey; baseUrl: string | null },
    modelId: string,
  ) => ProviderHandle;
  countRequestsInLastHour: (workspaceId: string) => Promise<number>;
};

export type PrepareResult =
  | { ok: true; handle: ProviderHandle; credentialId: string }
  | { ok: false; code: 'ai_credential_missing' }
  | { ok: false; code: 'rate_limited'; limit: number; retryAfterSeconds: number };

/**
 * Pořadí kontrol je součást kritéria 7b: dokud nemáme klíč projektu, nesmí
 * vzniknout ani model, natož odchozí požadavek. Proto se nejdřív načte
 * credential a teprve pak se cokoliv staví.
 */
export async function prepareConversation(
  params: PrepareParams,
  deps: PrepareDeps,
): Promise<PrepareResult> {
  const credential = await deps.loadCredential({
    workspaceId: params.workspaceId,
    credentialId: params.credentialId,
  });
  if (credential === null) {
    return { ok: false, code: 'ai_credential_missing' };
  }

  const used = await deps.countRequestsInLastHour(params.workspaceId);
  if (used >= params.ratePerHour) {
    return { ok: false, code: 'rate_limited', limit: params.ratePerHour, retryAfterSeconds: 600 };
  }

  const apiKey = deps.decryptApiKey({
    workspaceId: params.workspaceId,
    stored: credential.stored,
  });
  const modelId = params.model ?? credential.defaultModel;
  const handle = deps.buildModel(
    { provider: credential.provider, apiKey, baseUrl: credential.baseUrl },
    modelId,
  );
  return { ok: true, handle, credentialId: credential.id };
}

export type UserMessage = {
  role: 'user';
  parts: Array<{ type: string; text?: string }>;
};

export type RunConversationParams = {
  workspaceId: string;
  workspaceName?: string;
  templateId: string;
  language: string;
  conversationId?: string | null;
  userMessage: UserMessage;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

export type StreamConversationArgs = {
  model: unknown;
  system: string;
  messages: unknown;
  tools: AssistantTools;
  maxOutputTokens: number;
  maxRetries: number;
  stepLimit: number;
  abortSignal?: AbortSignal;
};

export type RunConversationDeps = {
  model: unknown;
  /** Katalog polí z P07. Do promptu z něj jdou jen definice, nikdy hodnoty. */
  fieldCatalog: MergeTagCatalog;
  loadHistory: (params: {
    workspaceId: string;
    conversationId: string | null;
  }) => Promise<ConversationTurn[]>;
  appendMessage: (message: Record<string, unknown>) => Promise<void>;
  recordUsage: (usage: Record<string, unknown>) => Promise<void>;
  /**
   * Hranice, za kterou prompt odchází do AI SDK a odtud providerovi.
   * Skutečnou implementaci dodává adaptér `src/ai/sdk`; test kritéria 70
   * si sem sáhne, aby viděl přesně to, co by odešlo.
   */
  streamConversation: (args: StreamConversationArgs) => unknown;
  toolImplementations: Pick<
    ToolContext,
    'startBrandExtraction' | 'composeTemplate' | 'writeCopy' | 'suggestSubject'
  >;
};

function textOf(message: UserMessage): string {
  return message.parts.map((part) => part.text ?? '').join(' ');
}

/**
 * Sestaví celý odchozí požadavek konverzace: systémový prompt, historii,
 * nástroje a strop kroků. Do promptu jdou jen názvy polí, nikdy hodnoty
 * kontaktů (kritérium 70).
 */
export async function runConversation(
  params: RunConversationParams,
  deps: RunConversationDeps,
): Promise<unknown> {
  const history = await deps.loadHistory({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId ?? null,
  });

  const incomingText = textOf(params.userMessage);
  const userUrls = collectUserUrls([...history, { role: 'user', text: incomingText }]);

  const tools = buildTools({
    workspaceId: params.workspaceId,
    templateId: params.templateId,
    language: params.language,
    userUrls,
    fieldCatalog: deps.fieldCatalog,
    ...deps.toolImplementations,
  });

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user' as const, content: incomingText },
  ];

  await deps.appendMessage({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId ?? null,
    role: 'user',
    parts: params.userMessage.parts,
  });

  return deps.streamConversation({
    model: deps.model,
    system: buildSystemPrompt({
      language: params.language,
      workspaceName: params.workspaceName ?? '',
    }),
    messages,
    tools,
    maxOutputTokens: params.maxOutputTokens ?? 16_000,
    maxRetries: 2,
    stepLimit: MAX_TOOL_STEPS,
    ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
  });
}
