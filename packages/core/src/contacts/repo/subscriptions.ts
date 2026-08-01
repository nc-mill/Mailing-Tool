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
