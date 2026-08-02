import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { WorkspaceContext } from '../identity/types';
import { listContactFields } from '../contacts/repo/contact-fields';
import type { MergeTagCatalog } from './tools/list-merge-tags';
import type { Tx } from '../tx';
import type { CredentialRow } from './credential-service';
import type { ConversationTurn } from './tools/context';
import type { ProviderId } from './providers';
import type { UsageUpsert } from './usage';

/**
 * Přístup k tabulkám `ai_*`. Bydlí v `packages/core`, protože podle grafu
 * závislostí (3.11 části 1) smí SQL psát jen jádro; `apps/web` sem jen
 * předává otevřenou transakci.
 *
 * Žádná z těchhle funkcí neomezuje dotaz na `workspace_id` sama: nad všemi
 * tabulkami `ai_*` běží RLS (migrace 0004) a transakce je otevřená
 * `withWorkspace`, takže projekt vybírá databáze. Dvojí filtrace by jen
 * zakryla, kdyby politika chyběla.
 */

export type StoredCredential = {
  id: string;
  provider: ProviderId;
  stored: string;
  defaultModel: string;
  baseUrl: string | null;
};

/**
 * Klíč pro konverzaci. Bez `credentialId` se bere výchozí klíč projektu;
 * když projekt žádný nemá, vrací se `null` a volající NESMÍ nic stavět
 * (kritérium 7b).
 */
export async function loadCredential(
  tx: Tx,
  params: { credentialId: string | null },
): Promise<StoredCredential | null> {
  const table = schema.aiProviderCredentials;
  const rows = await tx
    .select({
      id: table.id,
      provider: table.provider,
      stored: table.apiKeyEncrypted,
      defaultModel: table.defaultModel,
      baseUrl: table.baseUrl,
    })
    .from(table)
    .where(
      params.credentialId === null
        ? eq(table.defaultCredential, true)
        : eq(table.id, params.credentialId),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return { ...row, provider: row.provider as ProviderId };
}

export async function listCredentials(tx: Tx): Promise<CredentialRow[]> {
  const table = schema.aiProviderCredentials;
  const rows = await tx.select().from(table).orderBy(asc(table.createdAt));
  // `CredentialRow` nese časy jako ISO řetězce, drizzle je vrací jako `Date`.
  // Převod patří sem, do jediného místa, kde se řádek vyrábí.
  const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider as ProviderId,
    label: row.label,
    keyHint: row.keyHint,
    keyFingerprint: row.keyFingerprint,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    defaultCredential: row.defaultCredential,
    lastUsedAt: iso(row.lastUsedAt),
    lastErrorAt: iso(row.lastErrorAt),
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Katalog polí pro nástroj `list_merge_tags`, kritérium 70.
 *
 * Bere z P07 VÝHRADNĚ definice: klíč, typ a popisek. Žádná hodnota kontaktu se
 * nečte, ani z ukázkového kontaktu, protože i ukázkový kontakt je skutečný
 * řádek z databáze projektu. Ukázky si `listMergeTags` vyrábí z typu sám.
 */
export async function loadFieldCatalog(ctx: WorkspaceContext): Promise<MergeTagCatalog> {
  const fields = await listContactFields(ctx, { includeArchived: false });
  return {
    fields: fields.map((field) => ({
      path: field.key,
      type: field.type,
      label: field.label,
      deleted: field.archivedAt !== null,
    })),
  };
}

/** Řádek klíče tak, jak ho skládá `handleCreateCredential`. */
export type InsertCredentialRow = {
  workspaceId: string;
  provider: string;
  label: string;
  apiKeyEncrypted: string;
  keyFingerprint: string;
  keyHint: string;
  baseUrl: string | null;
  defaultModel: string;
  createdBy: string | null;
};

/**
 * Uloží klíč. První klíč projektu se rovnou stane výchozím, aby konverzace
 * fungovala hned po uložení a uživatel nemusel hledat další přepínač.
 */
export async function insertCredential(
  tx: Tx,
  row: Record<string, unknown>,
): Promise<{ id: string }> {
  const table = schema.aiProviderCredentials;
  const typed = row as unknown as InsertCredentialRow;

  const existing = await tx.select({ id: table.id }).from(table).limit(1);

  const inserted = await tx
    .insert(table)
    .values({
      workspaceId: typed.workspaceId,
      provider: typed.provider,
      label: typed.label,
      apiKeyEncrypted: typed.apiKeyEncrypted,
      keyFingerprint: typed.keyFingerprint,
      keyHint: typed.keyHint,
      baseUrl: typed.baseUrl,
      defaultModel: typed.defaultModel,
      defaultCredential: existing.length === 0,
      createdBy: typed.createdBy,
    })
    .returning({ id: table.id });

  const created = inserted[0];
  if (created === undefined) throw new Error('ai_provider_credentials: INSERT nevrátil řádek.');
  return created;
}

export async function findCredentialByFingerprint(
  tx: Tx,
  params: { fingerprint: string },
): Promise<{ id: string; label: string } | null> {
  const table = schema.aiProviderCredentials;
  const rows = await tx
    .select({ id: table.id, label: table.label })
    .from(table)
    .where(eq(table.keyFingerprint, params.fingerprint))
    .limit(1);
  return rows[0] ?? null;
}

export async function markCredentialOk(tx: Tx, credentialId: string): Promise<void> {
  const table = schema.aiProviderCredentials;
  await tx
    .update(table)
    .set({ lastUsedAt: new Date(), lastErrorAt: null, lastErrorCode: null, updatedAt: new Date() })
    .where(eq(table.id, credentialId));
}

export async function markCredentialError(
  tx: Tx,
  credentialId: string,
  code: string,
): Promise<void> {
  const table = schema.aiProviderCredentials;
  await tx
    .update(table)
    .set({ lastErrorAt: new Date(), lastErrorCode: code, updatedAt: new Date() })
    .where(eq(table.id, credentialId));
}

/**
 * Smaže klíč natrvalo. `ai_conversations.credential_id` je `ON DELETE SET NULL`
 * (P03), takže dřívější konverzace zůstanou, jen bez použitelného klíče pro
 * další zprávu. Stejné chování jako smazání odesílacího účtu u P04.
 */
export async function deleteCredential(tx: Tx, credentialId: string): Promise<boolean> {
  const table = schema.aiProviderCredentials;
  const rows = await tx.delete(table).where(eq(table.id, credentialId)).returning({ id: table.id });
  return rows.length > 0;
}

/**
 * Přepne výchozí klíč. Nejdřív se smaže starý příznak, pak se nastaví nový:
 * dvěma příkazy v téže transakci, aby unikátnost „nejvýš jeden výchozí"
 * nikdy neprošla dvěma řádky najednou. Vrací `false`, když klíč pod daným
 * id v projektu neexistuje (RLS ho tím pádem vůbec neuvidí).
 */
export async function setDefaultCredential(tx: Tx, credentialId: string): Promise<boolean> {
  const table = schema.aiProviderCredentials;
  const existing = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, credentialId))
    .limit(1);
  if (existing.length === 0) return false;

  await tx
    .update(table)
    .set({ defaultCredential: false, updatedAt: new Date() })
    .where(eq(table.defaultCredential, true));
  await tx
    .update(table)
    .set({ defaultCredential: true, updatedAt: new Date() })
    .where(eq(table.id, credentialId));
  return true;
}

/**
 * Kolik požadavků projekt poslal za poslední hodinu. Počítají se uživatelské
 * zprávy, protože právě ony spouštějí odchozí volání; asistentské zprávy
 * a výsledky nástrojů jsou jejich následek, ne další požadavek.
 */
export async function countRequestsInLastHour(tx: Tx): Promise<number> {
  const table = schema.aiMessages;
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(and(eq(table.role, 'user'), gte(table.createdAt, since)));
  return rows[0]?.count ?? 0;
}

/**
 * Historie konverzace ve tvaru, kterému rozumí `collectUserUrls`. Vrací se
 * jen role a text, nikdy identifikátory ani metadata: do promptu jde přesně
 * tolik, kolik je potřeba.
 */
export async function loadConversationTurns(
  tx: Tx,
  params: { conversationId: string | null },
): Promise<ConversationTurn[]> {
  if (params.conversationId === null) return [];
  const table = schema.aiMessages;
  const rows = await tx
    .select({ role: table.role, parts: table.parts })
    .from(table)
    .where(eq(table.conversationId, params.conversationId))
    .orderBy(asc(table.seq));

  return rows.map((row) => ({ role: row.role, text: textFromParts(row.parts) }));
}

/** Zprávy se ukládají jako pole částí AI SDK. Text se z nich skládá pro prompt. */
export function textFromParts(parts: unknown): string {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (part as { text?: unknown } | null)?.text)
    .filter((text): text is string => typeof text === 'string')
    .join(' ');
}

/**
 * Založí konverzaci, když ještě neexistuje. Vrací identifikátor, pod kterým
 * se pak ukládají zprávy.
 */
export async function ensureConversation(
  tx: Tx,
  params: {
    workspaceId: string;
    conversationId: string | null;
    templateId: string | null;
    credentialId: string;
    model: string;
    createdBy: string | null;
  },
): Promise<string | null> {
  if (params.conversationId !== null) return params.conversationId;

  const rows = await tx
    .insert(schema.aiConversations)
    .values({
      workspaceId: params.workspaceId,
      templateId: params.templateId,
      credentialId: params.credentialId,
      model: params.model,
      createdBy: params.createdBy,
    })
    .returning({ id: schema.aiConversations.id });

  return rows[0]?.id ?? null;
}

export type AppendMessageParams = {
  workspaceId: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  finishReason?: string | null;
  errorCode?: string | null;
};

/**
 * Připojí zprávu na konec konverzace. `seq` se dopočítává v témže příkazu,
 * ne dvěma dotazy: unikátní index `uq_ai_messages__ws_conversation_seq`
 * by při souběhu jinak spadl na duplicitě.
 */
export async function appendMessage(tx: Tx, params: AppendMessageParams): Promise<void> {
  const table = schema.aiMessages;
  await tx.insert(table).values({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    seq: sql`(SELECT coalesce(max(m.seq), 0) + 1 FROM ${table} m WHERE m.conversation_id = ${params.conversationId}::uuid)`,
    role: params.role,
    parts: params.parts,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    finishReason: params.finishReason ?? null,
    errorCode: params.errorCode ?? null,
  });

  await tx
    .update(schema.aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.aiConversations.id, params.conversationId));
}

/** Denní agregát spotřeby. Přičítá se, nikdy nepřepisuje. */
export async function upsertDailyUsage(tx: Tx, input: UsageUpsert): Promise<void> {
  const table = schema.aiUsageDaily;
  await tx
    .insert(table)
    .values({
      workspaceId: input.workspaceId,
      day: input.day,
      provider: input.provider,
      model: input.model,
      requests: input.requestsDelta,
      inputTokens: input.inputTokensDelta,
      outputTokens: input.outputTokensDelta,
      errors: input.errorsDelta,
    })
    .onConflictDoUpdate({
      target: [table.workspaceId, table.day, table.provider, table.model],
      set: {
        requests: sql`${table.requests} + ${input.requestsDelta}`,
        inputTokens: sql`${table.inputTokens} + ${input.inputTokensDelta}`,
        outputTokens: sql`${table.outputTokens} + ${input.outputTokensDelta}`,
        errors: sql`${table.errors} + ${input.errorsDelta}`,
      },
    });
}

export type ConversationSummaryRow = {
  id: string;
  templateId: string | null;
  title: string | null;
  model: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listConversations(
  tx: Tx,
  params: { templateId?: string | undefined; limit: number },
): Promise<ConversationSummaryRow[]> {
  const table = schema.aiConversations;
  const query = tx
    .select({
      id: table.id,
      templateId: table.templateId,
      title: table.title,
      model: table.model,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .orderBy(desc(table.updatedAt))
    .limit(params.limit);

  return params.templateId === undefined
    ? query
    : query.where(eq(table.templateId, params.templateId));
}

export type ConversationMessageRow = {
  id: string;
  seq: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  errorCode: string | null;
  createdAt: Date;
};

export async function getConversation(
  tx: Tx,
  conversationId: string,
): Promise<(ConversationSummaryRow & { messages: ConversationMessageRow[] }) | null> {
  const table = schema.aiConversations;
  const rows = await tx
    .select({
      id: table.id,
      templateId: table.templateId,
      title: table.title,
      model: table.model,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .where(eq(table.id, conversationId))
    .limit(1);

  const conversation = rows[0];
  if (conversation === undefined) return null;

  const messages = schema.aiMessages;
  const messageRows = await tx
    .select({
      id: messages.id,
      seq: messages.seq,
      role: messages.role,
      parts: messages.parts,
      inputTokens: messages.inputTokens,
      outputTokens: messages.outputTokens,
      finishReason: messages.finishReason,
      errorCode: messages.errorCode,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.seq));

  return { ...conversation, messages: messageRows };
}

export async function deleteConversation(tx: Tx, conversationId: string): Promise<boolean> {
  const rows = await tx
    .delete(schema.aiConversations)
    .where(eq(schema.aiConversations.id, conversationId))
    .returning({ id: schema.aiConversations.id });
  return rows.length > 0;
}

/** Spotřeba za období. Sečtení a přepočet na peníze dělá `buildUsageReport`. */
export async function loadUsageRows(
  tx: Tx,
  params: { from: string; to: string },
): Promise<
  Array<{
    day: string;
    provider: ProviderId;
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    errors: number;
  }>
> {
  const table = schema.aiUsageDaily;
  const rows = await tx
    .select()
    .from(table)
    .where(and(gte(table.day, params.from), sql`${table.day} <= ${params.to}`))
    .orderBy(asc(table.day));

  return rows.map((row) => ({
    day: row.day,
    provider: row.provider as ProviderId,
    model: row.model,
    requests: row.requests,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    errors: row.errors,
  }));
}
