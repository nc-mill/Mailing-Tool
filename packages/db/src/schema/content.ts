// packages/db/src/schema/content.ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './_types';
import { users, workspaces } from './identity';

export const assets = pgTable(
  'assets',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    publicId: text().notNull(),
    sha256: bytea().notNull(),
    byteSize: bigint({ mode: 'number' }).notNull(),
    mimeType: text().notNull(),
    width: integer(),
    height: integer(),
    frameCount: integer().notNull().default(1), // > 1 znamená animovaný GIF
    originalFilename: text().notNull(),
    altText: text(),
    source: text().notNull().default('upload'),
    storageKey: text().notNull(),
    // Denormalizace asset_references. Aktualizuje ji repository vrstva ve stejné
    // transakci jako zápis do asset_references, NE trigger: konvence triggery
    // zakazuje jako neviditelnou magii, kterou Go strana nezná.
    referenceCount: integer().notNull().default(0),
    hiddenAt: timestamp({ withTimezone: true }), // skryto z knihovny, soubor zůstává
    purgedAt: timestamp({ withTimezone: true }), // soubor smazán, jen při reference_count = 0
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_assets__public_id', sql`${t.publicId} ~ '^[0-9A-Za-z]{22}$'`),
    check('ck_assets__sha256_len', sql`octet_length(${t.sha256}) = 32`),
    check('ck_assets__byte_size', sql`${t.byteSize} > 0`),
    check('ck_assets__source', sql`${t.source} IN ('upload','brand_extraction','seed','ai')`),
    check('ck_assets__reference_count', sql`${t.referenceCount} >= 0`),
    // Deduplikace: stejný soubor nahraný podruhé se neuloží dvakrát.
    uniqueIndex('uq_assets__workspace_sha256')
      .on(t.workspaceId, t.sha256)
      .where(sql`${t.purgedAt} IS NULL`),
    // Veřejná URL obsahuje jen public_id, musí být globálně jednoznačné.
    uniqueIndex('uq_assets__public_id').on(t.publicId),
    index('idx_assets__workspace_created')
      .on(t.workspaceId, t.createdAt.desc())
      .where(sql`${t.hiddenAt} IS NULL AND ${t.purgedAt} IS NULL`),
  ],
);

/**
 * Výčty variant a druhů odkazu NEJSOU v databázi uzavřené schválně. Databáze
 * hlídá jen tvar identifikátoru, platný výčet vlastní registr v aplikaci.
 * Uzavřený CHECK by z přidání varianty udělal ALTER TABLE ... DROP CONSTRAINT
 * u každé instalace, a to je u self-hosted nasazení nejrizikovější operace.
 */
export const assetVariants = pgTable(
  'asset_variants',
  {
    // Rozhodnutí R26: workspace_id je denormalizované z assets, aby na tabulku
    // platila běžná ws_isolation. Nese úložné klíče, tedy data, u kterých únik
    // mezi projekty smysl dává; jednovrstvá ochrana přes repository je proti
    // zbytku modelu výjimka bez důvodu.
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    variant: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    byteSize: bigint({ mode: 'number' }).notNull(),
    mimeType: text().notNull(),
    storageKey: text().notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_asset_variants', columns: [t.workspaceId, t.assetId, t.variant] }),
    check('ck_asset_variants__variant', sql`${t.variant} ~ '^[a-z][a-z0-9_]{0,15}$'`),
  ],
);

export const assetReferences = pgTable(
  'asset_references',
  {
    // Rozhodnutí R26. Referenční graf říká, který asset je kde použitý,
    // tedy prozrazuje strukturu cizího projektu.
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    refType: text().notNull(),
    refId: uuid().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'pk_asset_references',
      columns: [t.workspaceId, t.assetId, t.refType, t.refId],
    }),
    check('ck_asset_references__ref_type', sql`${t.refType} ~ '^[a-z][a-z0-9_]{0,31}$'`),
    index('idx_asset_references__ref').on(t.workspaceId, t.refType, t.refId),
  ],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: text().$type<'campaign' | 'transactional' | 'system'>().notNull().default('campaign'),
    schemaVersion: integer().notNull().default(1),
    design: jsonb().notNull(),
    // SHA-256 nad KANONICKOU serializací JSON (klíče lexikograficky, bez mezer,
    // UTF-8). Autosave neukládá, když se nic nezměnilo; "vytvořit verzi" nevyrobí
    // duplicitu; náhled se cachuje podle hashe.
    designHash: bytea().notNull(),
    // Cizí klíč doplňuje migrace 0002, tady by tvořil cyklus.
    currentVersionId: uuid(),
    usedFields: text().array().notNull().default([]),
    thumbnailAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
    starter: boolean().notNull().default(false),
    validationState: text().$type<'unknown' | 'valid' | 'invalid'>().notNull().default('unknown'),
    validationErrors: jsonb().notNull().default([]),
    deletedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_templates__name_len', sql`length(${t.name}) BETWEEN 1 AND 120`),
    // Druh 'snippet' je zrušený: sdílené bloky mají jedno místo, content_snippets.
    check('ck_templates__kind', sql`${t.kind} IN ('campaign','transactional','system')`),
    check(
      'ck_templates__validation_state',
      sql`${t.validationState} IN ('unknown','valid','invalid')`,
    ),
    index('idx_templates__workspace_updated')
      .on(t.workspaceId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('uq_templates__workspace_name')
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_templates__invalid')
      .on(t.workspaceId)
      .where(sql`${t.validationState} = 'invalid' AND ${t.deletedAt} IS NULL`),
    // Vyhledání šablon podle merge tagu. Bez indexu by to byl sekvenční průchod
    // s deserializací JSON u každé šablony.
    index('idx_templates__used_fields').using('gin', t.usedFields),
  ],
);

export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    templateId: uuid()
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    schemaVersion: integer().notNull(),
    design: jsonb().notNull(),
    designHash: bytea().notNull(),
    compiledHtml: text(),
    compiledText: text(),
    compileMeta: jsonb(),
    rendererVersion: text(), // např. "r1.4.0", nutné pro reprodukovatelnost
    label: text(),
    reason: text().notNull().default('manual'),
    // Verze použitá kampaní. Nikdy se nemaže, je to důkaz, co přesně se rozeslalo.
    pinned: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_template_versions__version', sql`${t.version} >= 1`),
    check('ck_template_versions__label_len', sql`${t.label} IS NULL OR length(${t.label}) <= 80`),
    check(
      'ck_template_versions__reason',
      sql`${t.reason} IN
    ('manual','pre_send','ai_apply','restore','import')`,
    ),
    uniqueIndex('uq_template_versions__template_version').on(t.templateId, t.version),
    index('idx_template_versions__template_created').on(t.templateId, t.createdAt.desc()),
    index('idx_template_versions__cleanup')
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.pinned} = false`),
  ],
);

export const brandProfiles = pgTable(
  'brand_profiles',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    sourceUrl: text(),
    logoAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
    logoDarkAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
    palette: jsonb().notNull(),
    typography: jsonb().notNull(),
    tone: jsonb().notNull().default({}),
    // Bez prefixu is_, protože `default` je klíčové slovo.
    defaultProfile: boolean().notNull().default(false),
    extractedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Právě jedna výchozí značka na projekt. Částečný unikátní index to vynutí
    // v databázi, ne v aplikaci: souběžné "nastav jako výchozí" jinak vyrobí dvě.
    uniqueIndex('uq_brand_profiles__workspace_default')
      .on(t.workspaceId)
      .where(sql`${t.defaultProfile}`),
  ],
);

export const brandExtractions = pgTable(
  'brand_extractions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    inputUrl: text().notNull(),
    normalizedUrl: text().notNull(),
    status: text().notNull().default('pending'),
    errorCode: text(),
    hopSummary: jsonb().notNull().default([]), // bez syrových IP adres
    bytesFetched: bigint({ mode: 'number' }).notNull().default(0),
    durationMs: integer(),
    result: jsonb(),
    brandProfileId: uuid().references(() => brandProfiles.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'ck_brand_extractions__status',
      sql`${t.status} IN
    ('pending','running','succeeded','failed','blocked')`,
    ),
    // Rate limit "10 extrakcí za hodinu na projekt" se počítá tímhle indexem.
    index('idx_brand_extractions__workspace_created').on(t.workspaceId, t.createdAt.desc()),
  ],
);

/**
 * Výčet provider NENÍ v databázi uzavřený a je to podstatné: Azure OpenAI
 * a AWS Bedrock jsou připravené hodnoty bez implementace a jejich přidání
 * by jinak bylo ALTER TABLE ... DROP CONSTRAINT u každé instalace.
 */
export const aiProviderCredentials = pgTable(
  'ai_provider_credentials',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    label: text().notNull(),
    // Obálka enc:v1:<base64>, context 'ai_provider'. TEXT, ne bytea, viz 4.10.4.
    apiKeyEncrypted: text().notNull(),
    keyFingerprint: text().notNull(), // sha256(api_key), prvních 16 hex znaků
    keyHint: text().notNull(), // poslední 4 znaky klíče, pro UI
    baseUrl: text(),
    defaultModel: text().notNull(),
    defaultCredential: boolean().notNull().default(false),
    lastUsedAt: timestamp({ withTimezone: true }),
    lastErrorAt: timestamp({ withTimezone: true }),
    lastErrorCode: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_ai_provider_credentials__provider', sql`${t.provider} ~ '^[a-z][a-z0-9_]{0,31}$'`),
    check('ck_ai_provider_credentials__label_len', sql`length(${t.label}) BETWEEN 1 AND 60`),
    uniqueIndex('uq_ai_provider_credentials__workspace_label').on(
      t.workspaceId,
      sql`lower(${t.label})`,
    ),
    uniqueIndex('uq_ai_provider_credentials__workspace_default')
      .on(t.workspaceId)
      .where(sql`${t.defaultCredential}`),
  ],
);

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    templateId: uuid().references(() => templates.id, { onDelete: 'cascade' }),
    // Bez cizího klíče: campaigns vzniká v jiném souboru schématu a odkaz
    // přes hranici domény by tvořil cyklus mezi soubory.
    campaignId: uuid(),
    title: text(),
    credentialId: uuid().references(() => aiProviderCredentials.id, { onDelete: 'set null' }),
    model: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_ai_conversations__template_created').on(t.templateId, t.createdAt.desc()),
    // Seznam konverzací projektu podle poslední aktivity, a zároveň jediný
    // použitelný index pro kaskádu z workspaces.
    index('idx_ai_conversations__ws_updated').on(t.workspaceId, t.updatedAt.desc()),
  ],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid()
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    role: text().$type<'system' | 'user' | 'assistant' | 'tool'>().notNull(),
    parts: jsonb().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    finishReason: text(),
    errorCode: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_ai_messages__role', sql`${t.role} IN ('system','user','assistant','tool')`),
    // Konverzace se vždy čte celá a v pořadí. Tohle je jediný přístupový vzor.
    // workspace_id v čele: conversationId projekt jednoznačně určuje, takže se
    // unikátnost nemění, ale kaskádové mazání projektu i RLS dostanou index.
    uniqueIndex('uq_ai_messages__ws_conversation_seq').on(t.workspaceId, t.conversationId, t.seq),
  ],
);

/**
 * Agregát zapisovaný přes INSERT ... ON CONFLICT DO UPDATE. Existuje proto,
 * aby "kolik mě to stálo za posledních 30 dní" byl dotaz na 30 řádků,
 * ne na 30 000 zpráv.
 */
export const aiUsageDaily = pgTable(
  'ai_usage_daily',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    day: date().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    requests: integer().notNull().default(0),
    inputTokens: bigint({ mode: 'number' }).notNull().default(0),
    outputTokens: bigint({ mode: 'number' }).notNull().default(0),
    errors: integer().notNull().default(0),
    /**
     * SKUTEČNÁ účtovaná částka od poskytovatele, sečtená přes den. `null`
     * znamená „poskytovatel nám cenu nehlásí" nebo „ten den se ještě
     * nezapisovala"; nikdy to neznamená nulu.
     *
     * `numeric`, ne `double precision`: jedna odpověď asistenta stojí setiny
     * až tisíciny jednotky a součet přes den v plovoucí čárce se rozejde.
     */
    reportedCost: numeric({ precision: 20, scale: 10, mode: 'number' }),
    /**
     * JEDNOTKA té částky, například `openrouter_credit`. Ukládá se s ní
     * schválně: dokumentace OpenRouteru u `usage.cost` píše „credits" a NIKDE
     * neuvádí, že kredit je dolar. Bez jednotky by z čísla někdo dřív nebo
     * později udělal dolary a aplikace by to tvrdila uživateli.
     */
    reportedCostUnit: text(),
    /** Vstupní tokeny přečtené z mezipaměti. `null` = neměřeno, ne nula. */
    cacheReadTokens: bigint({ mode: 'number' }),
    /** Vstupní tokeny zapsané do mezipaměti. `null` = neměřeno, ne nula. */
    cacheWriteTokens: bigint({ mode: 'number' }),
  },
  (t) => [
    primaryKey({
      name: 'pk_ai_usage_daily',
      columns: [t.workspaceId, t.day, t.provider, t.model],
    }),
    // Částka bez jednotky je číslo, o kterém nikdo neví, co znamená. Přesně
    // tak vzniká záměna kreditů za dolary, tak ji databáze nepustí dovnitř.
    check(
      'ck_ai_usage_daily__reported_cost',
      sql`(${t.reportedCost} IS NULL AND ${t.reportedCostUnit} IS NULL)
    OR (${t.reportedCost} IS NOT NULL AND ${t.reportedCostUnit} IS NOT NULL AND ${t.reportedCost} >= 0)`,
    ),
    check(
      'ck_ai_usage_daily__cache_tokens',
      sql`(${t.cacheReadTokens} IS NULL OR ${t.cacheReadTokens} >= 0)
    AND (${t.cacheWriteTokens} IS NULL OR ${t.cacheWriteTokens} >= 0)`,
    ),
  ],
);

/** MVP 2. V MVP 0 se tabulka založí, ale UI ji nepoužívá, aby se pak nemuselo
 *  migrovat `design`. */
export const contentSnippets = pgTable(
  'content_snippets',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    design: jsonb().notNull(), // pole bloků, ne celý dokument
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_content_snippets__workspace_name').on(t.workspaceId, sql`lower(${t.name})`),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type AssetInsert = typeof assets.$inferInsert;
export type AssetVariant = typeof assetVariants.$inferSelect;
export type AssetVariantInsert = typeof assetVariants.$inferInsert;
export type AssetReference = typeof assetReferences.$inferSelect;
export type AssetReferenceInsert = typeof assetReferences.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type TemplateInsert = typeof templates.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type TemplateVersionInsert = typeof templateVersions.$inferInsert;
export type BrandProfile = typeof brandProfiles.$inferSelect;
export type BrandProfileInsert = typeof brandProfiles.$inferInsert;
export type BrandExtraction = typeof brandExtractions.$inferSelect;
export type BrandExtractionInsert = typeof brandExtractions.$inferInsert;
export type AiProviderCredential = typeof aiProviderCredentials.$inferSelect;
export type AiProviderCredentialInsert = typeof aiProviderCredentials.$inferInsert;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiConversationInsert = typeof aiConversations.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiMessageInsert = typeof aiMessages.$inferInsert;
export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
export type AiUsageDailyInsert = typeof aiUsageDaily.$inferInsert;
export type ContentSnippet = typeof contentSnippets.$inferSelect;
export type ContentSnippetInsert = typeof contentSnippets.$inferInsert;
