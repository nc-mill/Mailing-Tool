/**
 * Veřejná plocha domény AI pro `apps/web` a `apps/worker`.
 *
 * Musí existovat, protože mapa `exports` v `packages/core/package.json` má pro
 * neuvedené domény jediný vzor, který hvězdičku nahrazuje jménem domény
 * a doplňuje `index.ts`. Bez barrelu by `@mlain/core/ai/chat` skončilo na
 * `src/ai/chat/index.ts`, což je adresář, který neexistuje, a import by spadl
 * na ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * ADAPTÉR NAD AI SDK SE ODSUD ZÁMĚRNĚ NEREEXPORTUJE. Kdo ho potřebuje, sáhne
 * si na `@mlain/core/ai/sdk` (ta cesta na barrel `src/ai/sdk/index.ts` sedí).
 * Kdyby se reexportoval odsud, načetl by celé AI SDK každý, kdo si chce jen
 * přečíst katalog modelů.
 */

export { MAX_TOOL_STEPS, prepareConversation, runConversation } from './chat';
export type {
  PrepareDeps,
  PrepareParams,
  PrepareResult,
  RunConversationDeps,
  RunConversationParams,
  StreamConversationArgs,
  UserMessage,
} from './chat';

export { composeTemplateDraft } from './compose';
export type { ComposeDeps, ComposeParams, ComposeResult } from './compose';
export { composeSchema, type ComposeOutput } from './compose-schema';

export { compactToolResult, truncateRawOutput, MAX_RAW_OUTPUT_CHARS } from './conversation-service';
export type { CompactedToolResult } from './conversation-service';

export { buildModel, toApiKey } from './build-model';
export type {
  BuildModelOptions,
  DecryptedCredential,
  NonEmptyApiKey,
  ProviderFactories,
  ProviderHandle,
} from './build-model';

export {
  CATALOG_UPDATED_AT,
  PRICING_UPDATED_AT,
  curatedModels,
  defaultModelFor,
  estimateCostUsd,
  priceFor,
} from './catalog';
export type { ModelEntry, ModelPrice } from './catalog';

export {
  AI_CREDENTIAL_CONTEXT,
  decryptApiKey,
  encryptApiKey,
  fingerprintApiKey,
  hintFromApiKey,
  toPublicCredential,
} from './credential-service';
export type { CredentialRow, PublicCredential } from './credential-service';

export { mapProviderError } from './error-map';
export type { MappedProviderError } from './error-map';

export { createMeteredFetch, REDACTED_HEADERS } from './metered-fetch';
export { buildSystemPrompt } from './prompt';
export { probeProviderModels, ProviderCallError } from './probe';

export {
  PROVIDER_IDS,
  RESERVED_PROVIDER_IDS,
  allFallbackEnvVars,
  getProvider,
  isKnownProvider,
  listProviders,
  providerIdSchema,
} from './providers';
export type { ProviderDescriptor, ProviderId } from './providers';

export { buildUsageReport, recordUsage } from './usage';
export type { UsageByModel, UsageDay, UsageReport, UsageRow, UsageUpsert } from './usage';

export { collectUserUrls, isUrlFromUser } from './tools/context';
export type { ConversationTurn } from './tools/context';
export { buildTools } from './tools/index';
export type { ToolContext, ToolDefinition } from './tools/index';
export { listMergeTags } from './tools/list-merge-tags';
export type { MergeTag, MergeTagCatalog } from './tools/list-merge-tags';

export { AI_AUDIT } from './audit';
export * as aiRepo from './repo';
