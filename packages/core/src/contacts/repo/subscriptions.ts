import { and, eq, isNull, sql } from 'drizzle-orm';
import { listSubscriptions, subscriptionConfirmations } from '@mlain/db/schema';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import {
  confirmationExpiresAt,
  generateConfirmationToken,
  hashConfirmationToken,
} from '../lists/confirmation';
import type { SubscriptionStatus } from '../lists/state-machine';
import { storeIpEnabled } from '../privacy';

export type SubscriptionRow = typeof listSubscriptions.$inferSelect;
export type ConfirmationRecord = {
  id: string;
  contactId: string;
  listId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedIp: string | null;
};

export async function findSubscription(
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<SubscriptionRow | null> {
  return withWorkspace(ctx, async (tx) => findSubscriptionIn(tx, ctx, contactId, listId));
}

export async function findSubscriptionIn(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
): Promise<SubscriptionRow | null> {
  const rows = await tx
    .select()
    .from(listSubscriptions)
    .where(
      and(
        eq(listSubscriptions.workspaceId, ctx.workspaceId),
        eq(listSubscriptions.contactId, contactId),
        eq(listSubscriptions.listId, listId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type WriteSubscriptionInput = {
  contactId: string;
  listId: string;
  status: SubscriptionStatus;
  source: SubscriptionRow['source'];
  sourceRef?: string | null;
  confirmedAt?: Date | null;
  unsubscribedAt?: Date | null;
  unsubscribeReason?: SubscriptionRow['unsubscribeReason'];
  unsubscribeCampaignId?: string | null;
  snoozeUntil?: Date | null;
  confirmationSentAt?: Date | null;
  bumpResends?: boolean;
};

export async function writeSubscriptionIn(
  tx: Tx,
  ctx: WorkspaceContext,
  input: WriteSubscriptionInput,
): Promise<SubscriptionRow> {
  const rows = await tx
    .insert(listSubscriptions)
    .values({
      workspaceId: ctx.workspaceId,
      contactId: input.contactId,
      listId: input.listId,
      status: input.status,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      confirmedAt: input.confirmedAt ?? null,
      unsubscribedAt: input.unsubscribedAt ?? null,
      unsubscribeReason: input.unsubscribeReason ?? null,
      unsubscribeCampaignId: input.unsubscribeCampaignId ?? null,
      snoozeUntil: input.snoozeUntil ?? null,
      confirmationSentAt: input.confirmationSentAt ?? null,
      confirmationResends: 0,
    })
    .onConflictDoUpdate({
      target: [listSubscriptions.contactId, listSubscriptions.listId],
      set: {
        status: input.status,
        source: input.source,
        sourceRef: input.sourceRef ?? sql`${listSubscriptions.sourceRef}`,
        confirmedAt: input.confirmedAt ?? sql`${listSubscriptions.confirmedAt}`,
        unsubscribedAt: input.unsubscribedAt ?? sql`${listSubscriptions.unsubscribedAt}`,
        unsubscribeReason: input.unsubscribeReason ?? sql`${listSubscriptions.unsubscribeReason}`,
        snoozeUntil: input.snoozeUntil ?? null,
        confirmationSentAt:
          input.confirmationSentAt ?? sql`${listSubscriptions.confirmationSentAt}`,
        // Počítadlo se zvyšuje jen když se skutečně posílá e-mail, ne při každém zápisu.
        confirmationResends:
          input.bumpResends === true
            ? sql`${listSubscriptions.confirmationResends} + 1`
            : sql`${listSubscriptions.confirmationResends}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}

/**
 * Stavy přihlášení pro celou dávku najednou, jedním dotazem, uvnitř otevřené transakce.
 *
 * Import potřebuje u každé dvojice kontakt a seznam vědět, ZE KTERÉHO stavu přechází:
 * o dalším stavu rozhoduje `transition()` ze `lists/state-machine.ts` a bez výchozího
 * stavu by import odhlášeného člověka rovnou přepsal na `confirmed`, což je přesně to,
 * čemu automat brání. Volání `findSubscriptionIn` v cyklu by znamenalo tisíc dotazů
 * na dávku.
 *
 * Klíč mapy je `contactId:listId`.
 */
export async function readSubscriptionStatusesIn(
  tx: Tx,
  ctx: WorkspaceContext,
  contactIds: readonly string[],
  listIds: readonly string[],
): Promise<Map<string, SubscriptionStatus>> {
  const out = new Map<string, SubscriptionStatus>();
  if (contactIds.length === 0 || listIds.length === 0) return out;
  const { rows } = await tx.execute<{ contact_id: string; list_id: string; status: string }>(sql`
    SELECT contact_id, list_id, status FROM list_subscriptions
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND contact_id = ANY(${sql.param([...new Set(contactIds)])}::uuid[])
       AND list_id = ANY(${sql.param([...new Set(listIds)])}::uuid[])
  `);
  for (const row of rows) {
    out.set(`${row.contact_id}:${row.list_id}`, row.status as SubscriptionStatus);
  }
  return out;
}

/**
 * Dávkový zápis přihlášení jedním příkazem, uvnitř otevřené transakce.
 *
 * Tvar konfliktu i chování při něm jsou schválně stejné jako u `writeSubscriptionIn`
 * o kus výš, jen se hodnoty berou z `excluded` místo z parametrů. Rozdíl je v tom,
 * odkud se bere `confirmed_at` a `source_ref`: `coalesce(excluded.…, list_subscriptions.…)`
 * znamená „nepředané pole nech být", tedy totéž, co tam dělá `sql` odkaz na starou hodnotu.
 *
 * `snooze_until` se tady NEnuluje, na rozdíl od `writeSubscriptionIn`. Odložení rozesílky
 * je projev vůle příjemce a import, který jen znovu potvrzuje existující přihlášení,
 * nemá důvod ho zahodit.
 */
export async function writeSubscriptionsIn(
  tx: Tx,
  ctx: WorkspaceContext,
  rows: readonly WriteSubscriptionInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`
    INSERT INTO list_subscriptions (workspace_id, contact_id, list_id, status, source, source_ref,
                                    confirmed_at, confirmation_sent_at, confirmation_resends)
    SELECT ${ctx.workspaceId}::uuid, u.contact_id, u.list_id, u.status, u.source, u.source_ref,
           u.confirmed_at, u.confirmation_sent_at, 0
      FROM unnest(
        ${sql.param(rows.map((r) => r.contactId))}::uuid[],
        ${sql.param(rows.map((r) => r.listId))}::uuid[],
        ${sql.param(rows.map((r) => r.status))}::text[],
        ${sql.param(rows.map((r) => r.source))}::text[],
        ${sql.param(rows.map((r) => r.sourceRef ?? null))}::text[],
        ${sql.param(rows.map((r) => r.confirmedAt ?? null))}::timestamptz[],
        ${sql.param(rows.map((r) => r.confirmationSentAt ?? null))}::timestamptz[]
      ) AS u(contact_id, list_id, status, source, source_ref, confirmed_at, confirmation_sent_at)
    ON CONFLICT (contact_id, list_id) DO UPDATE SET
      status = excluded.status,
      source = excluded.source,
      source_ref = coalesce(excluded.source_ref, list_subscriptions.source_ref),
      confirmed_at = coalesce(excluded.confirmed_at, list_subscriptions.confirmed_at),
      confirmation_sent_at = coalesce(excluded.confirmation_sent_at,
                                      list_subscriptions.confirmation_sent_at),
      updated_at = now()
  `);
}

export type IssueConfirmationInput = {
  contactId: string;
  listId: string;
  ttlHours: number;
  requestIp?: string | null;
  requestUserAgent?: string | null;
  now?: Date;
};

/**
 * Vydá nový potvrzovací token a zneplatní všechny předchozí nespotřebované tokeny téže
 * dvojice kontakt a seznam (4.8.2). Bez toho by ve schránce zůstalo víc funkčních odkazů
 * a nešlo by doložit, kterým z nich člověk potvrdil.
 *
 * DDL nemá sloupec pro příznak "nahrazeno", takže zneplatnění se zapisuje jako consumed_at
 * bez consumed_ip. Rozdíl proti skutečnému spotřebování je tím dohledatelný: spotřebovaný
 * řádek má consumed_ip vyplněné (pokud projekt IP ukládá) a je to ten poslední vydaný.
 */
export async function issueConfirmation(
  ctx: WorkspaceContext,
  input: IssueConfirmationInput,
): Promise<{ token: string; expiresAt: Date }> {
  return withWorkspace(ctx, async (tx) => issueConfirmationIn(tx, ctx, input));
}

export async function issueConfirmationIn(
  tx: Tx,
  ctx: WorkspaceContext,
  input: IssueConfirmationInput,
): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();

  await tx
    .update(subscriptionConfirmations)
    .set({ consumedAt: now })
    .where(
      and(
        eq(subscriptionConfirmations.workspaceId, ctx.workspaceId),
        eq(subscriptionConfirmations.contactId, input.contactId),
        eq(subscriptionConfirmations.listId, input.listId),
        isNull(subscriptionConfirmations.consumedAt),
      ),
    );

  const { token, tokenHash } = generateConfirmationToken();
  const expiresAt = confirmationExpiresAt(now, input.ttlHours);
  const storeIp = await storeIpEnabled(tx, ctx);

  await tx.insert(subscriptionConfirmations).values({
    workspaceId: ctx.workspaceId,
    contactId: input.contactId,
    listId: input.listId,
    tokenHash,
    expiresAt,
    // Ukládání IP je volba provozovatele (rozhodnutí R8). User agent a čas zůstávají vždy,
    // protože bez nich by souhlas nebyl doložitelný vůbec.
    requestIp: storeIp ? (input.requestIp ?? null) : null,
    requestUserAgent: input.requestUserAgent ?? null,
  });

  return { token, expiresAt };
}

export async function findConfirmation(
  ctx: WorkspaceContext,
  token: string,
): Promise<ConfirmationRecord | null> {
  return withWorkspace(ctx, async (tx) => findConfirmationIn(tx, ctx, token));
}

export async function findConfirmationIn(
  tx: Tx,
  ctx: WorkspaceContext,
  token: string,
): Promise<ConfirmationRecord | null> {
  const rows = await tx
    .select()
    .from(subscriptionConfirmations)
    .where(
      and(
        eq(subscriptionConfirmations.workspaceId, ctx.workspaceId),
        eq(subscriptionConfirmations.tokenHash, hashConfirmationToken(token)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    contactId: row.contactId,
    listId: row.listId,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    consumedIp: row.consumedIp,
  };
}

/**
 * Spotřebuje token atomicky. Podmínka consumed_at IS NULL je v UPDATE, ne v předchozím
 * SELECT, takže dvě souběžná kliknutí nemohou potvrdit dvakrát: druhé ovlivní nula řádků.
 */
export async function consumeConfirmationIn(
  tx: Tx,
  ctx: WorkspaceContext,
  token: string,
  options: { consumedIp?: string | null; now?: Date },
): Promise<ConfirmationRecord | null> {
  const now = options.now ?? new Date();
  const storeIp = await storeIpEnabled(tx, ctx);

  const rows = await tx
    .update(subscriptionConfirmations)
    .set({ consumedAt: now, consumedIp: storeIp ? (options.consumedIp ?? null) : null })
    .where(
      and(
        eq(subscriptionConfirmations.workspaceId, ctx.workspaceId),
        eq(subscriptionConfirmations.tokenHash, hashConfirmationToken(token)),
        isNull(subscriptionConfirmations.consumedAt),
      ),
    )
    .returning();

  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    contactId: row.contactId,
    listId: row.listId,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    consumedIp: row.consumedIp,
  };
}

export async function consumeConfirmation(
  ctx: WorkspaceContext,
  token: string,
  options: { consumedIp?: string | null; now?: Date },
): Promise<ConfirmationRecord | null> {
  return withWorkspace(ctx, async (tx) => consumeConfirmationIn(tx, ctx, token, options));
}

/** Kolik potvrzovacích e-mailů odešlo na tuhle dvojici za posledních 24 hodin. */
export async function countResendsIn24h(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
  listId: string,
  now: Date,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(subscriptionConfirmations)
    .where(
      and(
        eq(subscriptionConfirmations.workspaceId, ctx.workspaceId),
        eq(subscriptionConfirmations.contactId, contactId),
        eq(subscriptionConfirmations.listId, listId),
        sql`${subscriptionConfirmations.createdAt} > ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}`,
      ),
    );
  return rows[0]?.total ?? 0;
}
