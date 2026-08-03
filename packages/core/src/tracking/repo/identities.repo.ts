import { sql } from 'drizzle-orm';
import type { Tx } from './tx';

/**
 * Čtení a zápis nad `identities`, `identity_bindings` a `identity_merges`.
 *
 * Všechny funkce berou `tx`, ne workspace jako řetězec: transakci otevírá
 * volající přes `withTrackingTx`, takže RLS je nastavená mimo tělo funkce
 * a špatně předané id nevrátí cizí řádky, jen prázdno. Pravidlo hlídá
 * `packages/core/src/identity/scope.test.ts`.
 */

export type BindingSource = 'email_click' | 'sdk_identify' | 'server_api' | 'form' | 'reset';

export type ContactGuardRow = {
  id: string;
  processingRestricted: boolean;
  deletedAt: Date | null;
};

/**
 * Krok 0 vazby i slučování: omezení zpracování podle článku 18 GDPR.
 *
 * Kontakt s uplatněným omezením se nemaže, ale nesmí se zpracovávat. Doplnit mu
 * `contact_id` do historických událostí a přepsat `last_activity_at` je
 * zpracování osobních údajů v přímém rozporu s omezením, takže se kontrola
 * dělá ZNOVU i v jobu: mezi vazbou a během jobu mohlo omezení přibýt.
 */
export async function selectContactGuard(
  tx: Tx,
  workspaceId: string,
  contactId: string,
): Promise<ContactGuardRow | null> {
  const { rows } = await tx.execute<ContactGuardRow>(sql`
    SELECT id, processing_restricted AS "processingRestricted", deleted_at AS "deletedAt"
      FROM contacts
     WHERE id = ${contactId} AND workspace_id = ${workspaceId}
  `);
  return rows[0] ?? null;
}

export type IdentityRow = {
  contactId: string | null;
  boundAt: Date | null;
  bindCount: number;
};

/** Aktuální vazba anonymního ID. `FOR UPDATE` drží souběžné vazby za sebou. */
export async function selectIdentityForUpdate(
  tx: Tx,
  workspaceId: string,
  anonymousId: string,
): Promise<IdentityRow | null> {
  const { rows } = await tx.execute<IdentityRow>(sql`
    SELECT contact_id AS "contactId", bound_at AS "boundAt", bind_count AS "bindCount"
      FROM identities
     WHERE workspace_id = ${workspaceId} AND anonymous_id = ${anonymousId}
       FOR UPDATE
  `);
  return rows[0] ?? null;
}

/**
 * Zámek nad jednou vazbou po dobu transakce.
 *
 * `identity_merges` nemá nad `binding_id` unikátní index, takže dvě souběžná
 * spuštění téže úlohy by jinak založila dva běhy nad týmiž událostmi. Singleton
 * klíč fronty (`<binding_id>`) to řeší jen do chvíle, než se úloha po vypršení
 * viditelnosti vyzvedne podruhé, zatímco první běh ještě žije.
 */
export async function lockBinding(tx: Tx, bindingId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${bindingId}, 0))`);
}

export type MergeRow = {
  id: string;
  status: string;
  windowFrom: Date;
  windowTo: Date;
  eventsTotal: number;
};

/** Poslední záznam o slučování pro danou vazbu. Nese idempotenci celého jobu. */
export async function selectMergeByBinding(
  tx: Tx,
  workspaceId: string,
  bindingId: string,
): Promise<MergeRow | null> {
  const { rows } = await tx.execute<{
    id: string;
    status: string;
    windowFrom: string | Date;
    windowTo: string | Date;
    eventsTotal: number;
  }>(sql`
    SELECT id, status,
           window_from   AS "windowFrom",
           window_to     AS "windowTo",
           events_total  AS "eventsTotal"
      FROM identity_merges
     WHERE workspace_id = ${workspaceId} AND binding_id = ${bindingId}
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const row = rows[0];
  if (row === undefined) return null;
  // `tx.execute` vrací hodnoty tak, jak je podá ovladač, a `timestamptz` z něj
  // u syrového SQL chodí jako řetězec. Bez převodu by `windowFrom.getTime()`
  // spadlo teprve při pokračování přerušeného běhu, tedy jen po pádu workeru.
  return {
    id: row.id,
    status: row.status,
    windowFrom: new Date(row.windowFrom),
    windowTo: new Date(row.windowTo),
    eventsTotal: row.eventsTotal,
  };
}

export type InsertMergeInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  bindingId: string;
  windowFrom: Date;
  windowTo: Date;
};

/** Založí běh ve stavu `running`. `id` nechává na `uuidv7()` z databáze. */
export async function insertMerge(tx: Tx, input: InsertMergeInput): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO identity_merges (workspace_id, anonymous_id, contact_id, binding_id,
                                 window_from, window_to, status)
    VALUES (${input.workspaceId}, ${input.anonymousId}, ${input.contactId}, ${input.bindingId},
            ${input.windowFrom}, ${input.windowTo}, 'running')
    RETURNING id
  `);
  return rows[0]!.id;
}

export type InsertBindingInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  source: BindingSource;
  evidence: Record<string, unknown>;
  now: Date;
};

/** Zápis do historie vazeb. Bez něj nejde slučování dohledat ani vrátit. */
export async function insertBinding(tx: Tx, input: InsertBindingInput): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO identity_bindings (workspace_id, anonymous_id, contact_id,
                                   valid_from, source, evidence)
    VALUES (${input.workspaceId}, ${input.anonymousId}, ${input.contactId},
            ${input.now}, ${input.source}, ${JSON.stringify(input.evidence)}::jsonb)
    RETURNING id
  `);
  return rows[0]!.id;
}

/**
 * Počet převazeb za posledních 24 hodin.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ SCHÉMATEM. Plán počítal se sloupcem
 * `identities.shared`. Tabulka ho v migracích P03 NEMÁ (`workspace_id`,
 * `anonymous_id`, `contact_id`, `bound_at`, `bind_count`, `first_seen`,
 * `last_seen`), a schéma vlastní P03. Sdílené zařízení se proto odvozuje
 * z historie vazeb, kterou drží `identity_bindings`, a čte se přesně tím
 * indexem, který na to P03 založil
 * (`idx_identity_bindings__lookup (workspace_id, anonymous_id, valid_from DESC)`).
 */
export async function countRecentBindings(
  tx: Tx,
  workspaceId: string,
  anonymousId: string,
  since: Date,
): Promise<number> {
  const { rows } = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
      FROM identity_bindings
     WHERE workspace_id = ${workspaceId}
       AND anonymous_id = ${anonymousId}
       AND valid_from >= ${since}
  `);
  return rows[0]?.count ?? 0;
}

export type UpsertIdentityInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  now: Date;
};

/** Založí nebo převáže aktuální vazbu a posune počítadlo i časy. */
export async function upsertIdentity(tx: Tx, input: UpsertIdentityInput): Promise<void> {
  await tx.execute(sql`
    INSERT INTO identities (workspace_id, anonymous_id, contact_id, bound_at,
                            bind_count, first_seen, last_seen)
    VALUES (${input.workspaceId}, ${input.anonymousId}, ${input.contactId}, ${input.now},
            1, ${input.now}, ${input.now})
    ON CONFLICT (workspace_id, anonymous_id) DO UPDATE
       SET contact_id = EXCLUDED.contact_id,
           bound_at   = EXCLUDED.bound_at,
           bind_count = identities.bind_count + 1,
           last_seen  = EXCLUDED.last_seen
  `);
}
