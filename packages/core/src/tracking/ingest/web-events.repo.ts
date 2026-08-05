import { sql } from 'drizzle-orm';
import type { Tx } from '../repo/tx';
import type { EventSource } from '../types';

/**
 * Zápis WEBOVÝCH událostí, viz plán P10 Task 32.
 *
 * ODCHYLKA OD PLÁNU, HRANICE VLASTNICTVÍ. Plán chtěl tyhle funkce
 * v `tracking/repo/web-events.repo.ts`. Ten soubor už existuje, patří cestě
 * otevření a prokliku e-mailu (`source = 'email'`, vždy s kontaktem, nikdy
 * s anonymním ID) a má funkci téhož jména s jiným podpisem. Přepsat ho by
 * znamenalo sáhnout do cizí, funkční a otestované cesty. Webový příjem má
 * proto vlastní repository vedle ní.
 *
 * ODCHYLKA OD PLÁNU, TRANSAKCE. Plán otevíral novou transakci v každé funkci.
 * Tady funkce berou `tx` a celý job běží v JEDNÉ transakci: dedup, zápis
 * událostí a doplnění mapy měsíců musí platit nebo neplatit společně. Kdyby
 * to bylo v pěti transakcích, pád po zápisu události by nechal řádek bez mapy
 * měsíců, tedy událost, kterou časová osa nikdy neuvidí.
 */

export type IngestedWebEventInsert = {
  id: string;
  occurredAt: Date;
  /** U živých cest `now()`, u importu odvozené z `occurredAt`, viz 2.2.1. */
  receivedAt: Date;
  workspaceId: string;
  name: string;
  anonymousId: string | null;
  contactId: string | null;
  sessionId: string | null;
  source: EventSource;
  page: Record<string, unknown>;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
};

/**
 * Vrátí ID těch událostí, které v okně sedmi dní už existují.
 *
 * Deduplikace je APLIKAČNÍ, ne databázová. Klíč `(id, received_at)` opakované
 * odeslání nezachytí, protože `received_at` se pokaždé liší. Okno sedmi dní
 * odpovídá životnosti offline fronty v SDK, takže pokrývá každý reálný případ.
 * Událost odeslaná znovu po víc než sedmi dnech se uloží dvakrát, což je dvě
 * identické položky v časové ose, ne poškozená data.
 */
export async function selectExistingEventIds(
  tx: Tx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM web_events
     WHERE workspace_id = ${workspaceId}
       AND id = ANY(${sql.param([...ids])}::uuid[])
       AND received_at >= now() - interval '7 days'
  `);
  return new Set(rows.map((row) => row.id));
}

/**
 * Celá dávka patří jednomu projektu: přišla jedním požadavkem ověřeným jedním
 * veřejným klíčem. Projekt se proto předává, negrupuje se z řádků.
 */
export async function insertIngestedWebEvents(
  tx: Tx,
  rows: readonly IngestedWebEventInsert[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const { rows: inserted } = await tx.execute<{ id: string }>(sql`
    INSERT INTO web_events (
      id, occurred_at, received_at, workspace_id, name, anonymous_id,
      contact_id, session_id, source, page, properties, context)
    SELECT * FROM unnest(
      ${sql.param(rows.map((r) => r.id))}::uuid[],
      ${sql.param(rows.map((r) => r.occurredAt))}::timestamptz[],
      ${sql.param(rows.map((r) => r.receivedAt))}::timestamptz[],
      ${sql.param(rows.map((r) => r.workspaceId))}::uuid[],
      ${sql.param(rows.map((r) => r.name))}::text[],
      ${sql.param(rows.map((r) => r.anonymousId))}::uuid[],
      ${sql.param(rows.map((r) => r.contactId))}::uuid[],
      ${sql.param(rows.map((r) => r.sessionId))}::uuid[],
      ${sql.param(rows.map((r) => r.source))}::text[],
      ${sql.param(rows.map((r) => JSON.stringify(r.page)))}::jsonb[],
      ${sql.param(rows.map((r) => JSON.stringify(r.properties)))}::jsonb[],
      ${sql.param(rows.map((r) => JSON.stringify(r.context)))}::jsonb[])
    ON CONFLICT (id, received_at) DO NOTHING
    RETURNING id
  `);
  return inserted.map((row) => row.id);
}

export type WebEventMonthRow = {
  subjectKind: 'contact' | 'anonymous';
  subjectId: string;
  month: Date;
};

/**
 * MAPA MĚSÍCŮ SE MUSÍ DOPLNIT SPOLU S UDÁLOSTÍ.
 *
 * `web_event_months` je řídká mapa „v kterých měsících má subjekt vůbec nějaká
 * data" a je to POVINNÝ předvýběr: časová osa i podmínka segmentu podle chování
 * se přes ni ptají dřív, než sáhnou na oddíly `web_events`. Bez řádku v mapě
 * se událost nezobrazí a segment nikoho nenajde, přestože je řádek zapsaný
 * správně. Nic přitom nespadne.
 *
 * Měsíc se bere z `received_at`, ne z `occurred_at`: musí odpovídat oddílu,
 * do kterého řádek spadl.
 */
export async function upsertWebEventMonths(
  tx: Tx,
  workspaceId: string,
  rows: readonly WebEventMonthRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`
    INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
    SELECT * FROM unnest(
      ${sql.param(rows.map(() => workspaceId))}::uuid[],
      ${sql.param(rows.map((r) => r.subjectKind))}::text[],
      ${sql.param(rows.map((r) => r.subjectId))}::uuid[],
      ${sql.param(rows.map((r) => r.month.toISOString().slice(0, 10)))}::date[])
    ON CONFLICT DO NOTHING
  `);
}

export type ResolvedIdentity = {
  contactId: string | null;
  processingRestricted: boolean;
  deletedAt: Date | null;
};

export async function resolveIdentity(
  tx: Tx,
  workspaceId: string,
  anonymousId: string,
): Promise<ResolvedIdentity | null> {
  const { rows } = await tx.execute<ResolvedIdentity>(sql`
    SELECT i.contact_id AS "contactId",
           COALESCE(c.processing_restricted, false) AS "processingRestricted",
           c.deleted_at AS "deletedAt"
      FROM identities i
      LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE i.workspace_id = ${workspaceId} AND i.anonymous_id = ${anonymousId}
  `);
  return rows[0] ?? null;
}

/**
 * Řádek `identities` musí vzniknout i pro návštěvníka, kterého nikdo nezná.
 * Bez něj by pozdější `bindIdentity` neměl co navázat a celá anonymní historie
 * by se při identifikaci ztratila.
 */
export async function ensureIdentityRow(
  tx: Tx,
  workspaceId: string,
  anonymousId: string,
  now: Date,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO identities (workspace_id, anonymous_id, contact_id, first_seen, last_seen)
    VALUES (${workspaceId}, ${anonymousId}, NULL, ${now}, ${now})
    ON CONFLICT (workspace_id, anonymous_id) DO UPDATE SET last_seen = ${now}
  `);
}

/** Práh 60 sekund brání tomu, aby aktivní návštěvník generoval desítky UPDATE na jeden řádek. */
export async function touchContactActivity(tx: Tx, contactId: string, at: Date): Promise<void> {
  await tx.execute(sql`
    UPDATE contacts
       SET last_activity_at = ${at}
     WHERE id = ${contactId}
       AND processing_restricted = false
       AND deleted_at IS NULL
       AND (last_activity_at IS NULL OR ${at}::timestamptz - last_activity_at > interval '60 seconds')
  `);
}
