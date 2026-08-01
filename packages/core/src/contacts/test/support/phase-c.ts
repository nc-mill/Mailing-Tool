import { Client, Pool } from 'pg';
import { keyringFromEnv } from '@mlain/contracts/keyring';
import { createWorkspaceContext } from '../../../identity/context';
import type { WorkspaceContext } from '../../../identity/types';
import { computeCurrentFingerprint } from '../../fingerprint';
import { registerConsentEraser } from '../../gdpr/consents-role';
import { recordConsent } from '../../repo/consents';
import { issueConfirmation } from '../../repo/subscriptions';
import { asMigrator, createActiveContact, createList, createSubscription } from './db';

/**
 * Pomůcky pro testy fáze C (úkoly 26 až 43).
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ VLASTNICTVÍM SOUBORŮ. Plán psal testy proti metodám
 * `ws.one`, `ws.seedContact` a `ws.setPrivacy` na objektu `TestWorkspace`. Ten objekt
 * žije v `test/support/db.ts`, který zakládá jiný úkol téhož plánu a souběžně ho píše
 * jiný agent. Pomůcky proto leží vedle, jako obyčejné funkce nad `asMigrator()`; dělají
 * přesně totéž a testy je volají místo metod.
 */

/** Jeden řádek kontrolního dotazu pod migrátorskou rolí, tedy mimo RLS testovaného kódu. */
export async function one<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const { rows } = await asMigrator().query<T>(text, [...params]);
  if (rows[0] === undefined) throw new Error(`dotaz nevrátil žádný řádek: ${text}`);
  return rows[0];
}

export async function maybeOne<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const { rows } = await asMigrator().query<T>(text, [...params]);
  return rows[0] ?? null;
}

export async function all<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const { rows } = await asMigrator().query<T>(text, [...params]);
  return rows;
}

/**
 * Nastaví větev `privacy` v nastavení projektu. Vlastní ji P04; test ji zapisuje přímo,
 * protože doména kontaktů ji jen čte a zapisovač pro ni nemá.
 */
export async function setPrivacy(
  ctx: WorkspaceContext,
  privacy: { store_ip: boolean },
): Promise<void> {
  await asMigrator().query(
    `UPDATE workspaces SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{privacy}', $2::jsonb, true)
      WHERE id = $1`,
    [ctx.workspaceId, JSON.stringify(privacy)],
  );
}

/**
 * Dočasně přepne keyring, jako by proběhla rotace klíče.
 *
 * Pokolení má deterministický klíč (32 bajtů vyplněných číslem pokolení), takže
 * otisk zapsaný pod pokolením 1 se dá po rotaci ověřit jen tehdy, když je pokolení 1
 * pořád v SECRET_KEY_PREVIOUS. Přesně to je věc, kterou testy kontroly otisků měří.
 */
export async function withKeyring<T>(
  generations: { current: number; all: readonly number[] },
  fn: () => Promise<T>,
): Promise<T> {
  const previousKey = process.env['SECRET_KEY'];
  const previousList = process.env['SECRET_KEY_PREVIOUS'];

  const material = (generation: number): string =>
    `${generation}:${Buffer.alloc(32, generation).toString('base64url')}`;

  process.env['SECRET_KEY'] = material(generations.current);
  const others = generations.all.filter((g) => g !== generations.current).map(material);
  if (others.length === 0) delete process.env['SECRET_KEY_PREVIOUS'];
  else process.env['SECRET_KEY_PREVIOUS'] = others.join(',');

  try {
    return await fn();
  } finally {
    if (previousKey === undefined) delete process.env['SECRET_KEY'];
    else process.env['SECRET_KEY'] = previousKey;
    if (previousList === undefined) delete process.env['SECRET_KEY_PREVIOUS'];
    else process.env['SECRET_KEY_PREVIOUS'] = previousList;
  }
}

/**
 * Stav po výmazu podle článku 17: v `email` je placeholder, plaintext je pryč
 * a jedinou stopou po původní adrese je otisk pod pokolením, které bylo aktuální
 * v době výmazu. Zapisuje se přímo, protože doménová cesta k tomuhle stavu vede
 * přes celý výmaz a test chce jen výchozí stav.
 */
export async function insertErasedSuppression(
  ctx: WorkspaceContext,
  input: { originalEmail: string },
): Promise<void> {
  const { fingerprint, keyId } = computeCurrentFingerprint(keyringFromEnv(), input.originalEmail);
  await asMigrator().query(
    `INSERT INTO suppressions (workspace_id, email, fingerprint, fingerprint_key_id,
                               reason, source, removable)
     VALUES ($1, $2, $3, $4, 'gdpr_erasure', 'gdpr', false)`,
    [ctx.workspaceId, `erased+${crypto.randomUUID()}@erased.invalid`, fingerprint, keyId],
  );
}

/**
 * Kolik dotazů nad tabulkou `suppressions` proběhne uvnitř funkce.
 *
 * Počítá se odposlechem na `Client.prototype.query`, tedy na tom místě, kudy jdou
 * všechny dotazy ovladače včetně těch z poolu. Test tím měří skutečný počet kol
 * do databáze, ne počet volání doménové funkce.
 */
export async function countSuppressionQueries<T>(fn: () => Promise<T>): Promise<number> {
  const original = Client.prototype.query;
  let count = 0;

  Client.prototype.query = function patched(this: Client, ...args: unknown[]) {
    const first = args[0];
    const text =
      typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
    if (/FROM suppressions/i.test(text)) count += 1;
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;

  try {
    await fn();
  } finally {
    Client.prototype.query = original;
  }
  return count;
}

export type SuppressionRow = {
  id: string;
  email: string;
  reason: string;
  removable: boolean;
  fingerprint: Buffer;
  fingerprint_key_id: number;
  metadata: Record<string, unknown>;
  removed_at: Date | null;
};

export async function suppressionRow(
  ctx: WorkspaceContext,
  suppressionId: string,
): Promise<SuppressionRow> {
  return one<SuppressionRow>(`SELECT * FROM suppressions WHERE workspace_id = $1 AND id = $2`, [
    ctx.workspaceId,
    suppressionId,
  ]);
}

export async function suppressionByEmail(
  ctx: WorkspaceContext,
  email: string,
): Promise<SuppressionRow> {
  return one<SuppressionRow>(
    `SELECT * FROM suppressions WHERE workspace_id = $1 AND email = $2 AND removed_at IS NULL`,
    [ctx.workspaceId, email],
  );
}

export async function suppressionForOrNull(
  ctx: WorkspaceContext,
  email: string,
): Promise<SuppressionRow | null> {
  return maybeOne<SuppressionRow>(
    `SELECT * FROM suppressions WHERE workspace_id = $1 AND email = $2 AND removed_at IS NULL`,
    [ctx.workspaceId, email],
  );
}

export async function countSuppressions(ctx: WorkspaceContext): Promise<number> {
  const row = await one<{ total: string }>(
    `SELECT count(*) AS total FROM suppressions WHERE workspace_id = $1`,
    [ctx.workspaceId],
  );
  return Number(row.total);
}

export async function contactStatus(ctx: WorkspaceContext, contactId: string): Promise<string> {
  const row = await one<{ status: string }>(
    `SELECT status FROM contacts WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, contactId],
  );
  return row.status;
}

export async function subscriptionStatus(
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<string> {
  const row = await one<{ status: string }>(
    `SELECT status FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
    [ctx.workspaceId, contactId, listId],
  );
  return row.status;
}

export async function snoozeUntil(
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<Date | null> {
  const row = await one<{ snooze_until: Date | null }>(
    `SELECT snooze_until FROM list_subscriptions
      WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
    [ctx.workspaceId, contactId, listId],
  );
  return row.snooze_until;
}

export type ConsentLogRow = {
  status: string;
  source: string;
  scope_list_id: string | null;
  purpose: string;
};

export async function latestConsent(
  ctx: WorkspaceContext,
  contactId: string,
  purpose: string,
): Promise<ConsentLogRow | null> {
  return maybeOne<ConsentLogRow>(
    `SELECT status, source, scope_list_id, purpose FROM consents
      WHERE workspace_id = $1 AND contact_id = $2 AND purpose = $3
      ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    [ctx.workspaceId, contactId, purpose],
  );
}

export async function auditActions(ctx: WorkspaceContext): Promise<string[]> {
  const rows = await all<{ action: string }>(
    `SELECT action FROM audit_log WHERE workspace_id = $1 ORDER BY created_at, id`,
    [ctx.workspaceId],
  );
  return rows.map((row) => row.action);
}

export async function lastWebhookEvent(
  ctx: WorkspaceContext,
): Promise<{ type: string; data: Record<string, unknown> } | null> {
  const row = await maybeOne<{ type: string; payload: Record<string, unknown> }>(
    `SELECT type, payload FROM webhook_events WHERE workspace_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [ctx.workspaceId],
  );
  return row === null ? null : { type: row.type, data: row.payload };
}

/**
 * Kontakt potvrzený na novém seznamu. Výchozí stav pro testy odhlášení, stížností
 * a výmazu: bez něj by se testovalo odhlášení někoho, kdo přihlášený nikdy nebyl.
 */
export async function confirmedSubscription(
  ctx: WorkspaceContext,
  email: string,
  listName: string,
): Promise<{ contact: { id: string }; list: { id: string } }> {
  const contact = await createActiveContact(ctx, email);
  const list = await createList(ctx, { name: listName });
  await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });
  await asMigrator().query(
    `UPDATE list_subscriptions SET confirmed_at = now()
      WHERE workspace_id = $1 AND contact_id = $2 AND list_id = $3`,
    [ctx.workspaceId, contact.id, list.id],
  );
  return { contact, list };
}

/**
 * Založí frontu pg-boss, aby do ní šlo zařadit job.
 *
 * Tabulka `pgboss.job` má cizí klíč na `pgboss.queue`, takže zařazení do nezaložené
 * fronty skončí na 23503 a test by hlásil chybu domény tam, kde chybí příprava.
 * Harness zakládá jen fronty fáze B; fronty GDPR a retence si dokládá tenhle soubor.
 *
 * Volá se `pgboss.create_queue`, tedy tatáž funkce, kterou uvnitř volá `boss.createQueue`.
 * Je idempotentní (ON CONFLICT DO NOTHING), takže opakované volání nevadí.
 */
export async function ensureQueue(name: string): Promise<void> {
  // Politika se předává výslovně: sloupec `queue.policy` je NOT NULL a funkce ho bere
  // z options bez výchozí hodnoty, takže prázdný objekt skončí na 23502.
  await asMigrator().query(`SELECT pgboss.create_queue($1, '{"policy":"standard"}'::jsonb)`, [
    name,
  ]);
  // Fronta s vlastním oddílem by vznikla jako nová tabulka, na kterou se dřívější grant
  // nevztahuje. Grant se proto opakuje; u nepartitionovaných front je to bez efektu.
  await asMigrator().query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
}

export type GdprRequestRow = {
  id: string;
  status: string;
  verified_at: Date | null;
  completed_at: Date | null;
  type: string;
  mode: string | null;
  due_at: Date;
  affected: Record<string, unknown>;
};

export async function gdprRequestRow(
  ctx: WorkspaceContext,
  requestId: string,
): Promise<GdprRequestRow> {
  return one<GdprRequestRow>(`SELECT * FROM gdpr_requests WHERE workspace_id = $1 AND id = $2`, [
    ctx.workspaceId,
    requestId,
  ]);
}

/**
 * Pool pod rolí `mlain_gdpr`, tedy pod jedinou rolí, která má DELETE na `consents`.
 *
 * Přihlašovací údaje se odvozují z migrátorského spojení harnessu; role se zakládají
 * s heslem rovným jménu role (viz `HARNESS_ROLES` v pg-harness).
 */
let gdprPoolInstance: Pool | null = null;

export function gdprPool(): Pool {
  if (gdprPoolInstance !== null) return gdprPoolInstance;
  const migratorUrl = process.env['DATABASE_URL_MIGRATOR'];
  if (migratorUrl === undefined) throw new Error('DATABASE_URL_MIGRATOR není nastavená');
  const url = migratorUrl.replace('mlain_migrator:mlain_migrator', 'mlain_gdpr:mlain_gdpr');
  gdprPoolInstance = new Pool({ connectionString: url, max: 2 });
  return gdprPoolInstance;
}

export async function closeGdprPool(): Promise<void> {
  await gdprPoolInstance?.end();
  gdprPoolInstance = null;
}

/**
 * Zaregistruje mazač souhlasů pod rolí `mlain_gdpr`, tedy to, co v produkci dodá P04
 * obálkou `withGdpr` nad rozšířeným `PoolKind`. Testy díky tomu ověří OBĚ větve
 * rozhodnutí R13: bez registrace musí výmaz selhat, s ní musí projít.
 */
export function useGdprConsentEraser(): void {
  registerConsentEraser(async ({ workspaceId, contactId }) => {
    const client = await gdprPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [workspaceId]);
      const result = await client.query(
        `DELETE FROM consents WHERE workspace_id = $1 AND contact_id = $2`,
        [workspaceId, contactId],
      );
      await client.query('COMMIT');
      return { deleted: result.rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

/**
 * Kontakt se vším, co po něm výmaz musí uklidit: jméno, vlastní pole, štítek,
 * potvrzené přihlášení, souhlas a potvrzovací token.
 */
export async function createFullContact(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ id: string; listId: string }> {
  const contact = await createActiveContact(ctx, email);
  const list = await createList(ctx, { name: `Seznam ${Date.now()}${Math.random()}` });
  await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });

  await asMigrator().query(
    `UPDATE contacts SET first_name = 'Jana', last_name = 'Nováková',
        first_name_key = 'jana', last_name_key = 'novakova',
        greeting = 'Dobrý den, Jano', greeting_neutral = 'Dobrý den',
        gender = 'female', attributes = '{"city":"Brno"}'::jsonb,
        timezone = 'Europe/Prague', source_ref = 'ruční'
      WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, contact.id],
  );

  const { rows: tagRows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO tags (workspace_id, name) VALUES ($1, $2) RETURNING id`,
    [ctx.workspaceId, `stitek-${Date.now()}${Math.random()}`.slice(0, 40)],
  );
  await asMigrator().query(
    `INSERT INTO contact_tags (contact_id, tag_id, workspace_id) VALUES ($1, $2, $3)`,
    [contact.id, tagRows[0]!.id, ctx.workspaceId],
  );

  await recordConsent(ctx, {
    contactId: contact.id,
    purpose: 'email_marketing',
    status: 'granted',
    legalBasis: 'consent',
    scopeListId: list.id,
    source: 'form',
  });

  await issueConfirmation(ctx, { contactId: contact.id, listId: list.id, ttlHours: 168 });

  return { id: contact.id, listId: list.id };
}

export async function contactRow(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<Record<string, unknown>> {
  return one(`SELECT * FROM contacts WHERE workspace_id = $1 AND id = $2`, [
    ctx.workspaceId,
    contactId,
  ]);
}

export async function contactExists(ctx: WorkspaceContext, contactId: string): Promise<boolean> {
  const row = await maybeOne(`SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2`, [
    ctx.workspaceId,
    contactId,
  ]);
  return row !== null;
}

export async function countRowsFor(
  table: string,
  ctx: WorkspaceContext,
  contactId: string,
): Promise<number> {
  const row = await one<{ total: string }>(
    `SELECT count(*) AS total FROM ${table} WHERE workspace_id = $1 AND contact_id = $2`,
    [ctx.workspaceId, contactId],
  );
  return Number(row.total);
}

/** Suppression řádek dohledaný přes otisk původní adresy, tedy tak, jak ho hledá kontrola. */
export async function suppressionByFingerprintOf(
  ctx: WorkspaceContext,
  email: string,
): Promise<SuppressionRow | null> {
  const { fingerprint } = computeCurrentFingerprint(keyringFromEnv(), email);
  return maybeOne<SuppressionRow>(
    `SELECT * FROM suppressions WHERE workspace_id = $1 AND fingerprint = $2 AND removed_at IS NULL`,
    [ctx.workspaceId, fingerprint],
  );
}

/**
 * Tentýž projekt, ale kontext s jinou rolí člena.
 *
 * Role se bere z tabulky `memberships`, ne z parametru, takže se mění tam a kontext
 * se vyrobí znovu jedinou povolenou továrnou. Test tím ověřuje skutečné oprávnění,
 * ne podstrčenou hodnotu.
 */
export async function contextWithRole(
  ctx: WorkspaceContext,
  role: 'owner' | 'admin' | 'editor' | 'viewer',
): Promise<WorkspaceContext> {
  if (ctx.actor.type !== 'user') throw new Error('kontext bez uživatele nemá roli');
  const userId = ctx.actor.userId;
  await asMigrator().query(
    `UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
    [ctx.workspaceId, userId, role],
  );
  return createWorkspaceContext({ kind: 'session', userId, workspaceRef: ctx.workspaceId });
}
