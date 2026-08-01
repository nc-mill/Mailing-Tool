import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace } from '../../tx';
import { revokePendingMessages } from '../campaigns-port';
import { recordConsent } from '../repo/consents';
import { addSuppression } from '../repo/suppressions';

export type UnsubscribeReason =
  'link' | 'one_click' | 'preference_center' | 'api' | 'manual' | 'global' | 'objection';

export type UnsubscribeInput = {
  contactId: string;
  /**
   * Rozsah odhlášení. null znamená globální.
   *
   * POZOR: tahle hodnota se dál předává do revokePendingMessages, kde je parametr
   * VOLITELNÝ. Předává se proto vždy explicitně, i když je null. Vynechání by v části 4a
   * znamenalo "zruš všechny čekající zprávy kontaktu", tedy jiný rozsah, než jaký
   * uživatel zvolil, a byla by to tichá ztráta pošty. Viz kritérium 79.
   */
  listId: string | null;
  reason: UnsubscribeReason;
  campaignId?: string | null;
};

/**
 * Odhlášení podle tabulky rozsahů ve 4.9.2 části 2.
 *
 * Rozdíl mezi odhlášením ze seznamu a globálním je nejčastější zdroj nedorozumění,
 * proto je na stránce předvoleb napsaný doslova a proto ho tahle funkce nikdy neodhaduje:
 * rozhoduje výhradně přítomnost listId v tokenu.
 */
export async function unsubscribe(
  ctx: WorkspaceContext,
  input: UnsubscribeInput,
): Promise<{ scope: 'list' | 'global' }> {
  const global = input.listId === null;
  const dbReason = input.reason;

  return withWorkspace(ctx, async (tx) => {
    const contact = await tx.execute<{ id: string; email: string }>(sql`
      SELECT id, email::text AS email FROM contacts
       WHERE id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
       FOR UPDATE
    `);
    const found = contact.rows[0];
    if (found === undefined) return { scope: global ? 'global' : 'list' };
    const email = found.email;

    if (global) {
      // Globální odhlášení: všechny seznamy, stav kontaktu, suppression a odvolání
      // souhlasu bez rozsahu. Suppression platí pro celý projekt, proto vzniká
      // jen tady a ne u odhlášení ze seznamu.
      await tx.execute(sql`
        UPDATE list_subscriptions
           SET status = 'unsubscribed', unsubscribed_at = now(),
               unsubscribe_reason = ${dbReason},
               unsubscribe_campaign_id = ${input.campaignId ?? null}::uuid,
               updated_at = now()
         WHERE contact_id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
           AND status <> 'unsubscribed'
      `);

      await addSuppression(ctx, {
        email,
        reason: input.reason === 'one_click' ? 'one_click_unsubscribe' : 'global_unsubscribe',
        source: input.reason,
        tx,
      });

      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing',
        status: 'withdrawn',
        legalBasis: 'consent',
        scopeListId: null,
        source:
          input.reason === 'objection'
            ? 'objection'
            : input.reason === 'one_click'
              ? 'one_click'
              : 'preference_center',
        tx,
      });
    } else {
      await tx.execute(sql`
        UPDATE list_subscriptions
           SET status = 'unsubscribed', unsubscribed_at = now(),
               unsubscribe_reason = ${dbReason},
               unsubscribe_campaign_id = ${input.campaignId ?? null}::uuid,
               updated_at = now()
         WHERE contact_id = ${input.contactId}::uuid AND list_id = ${input.listId}::uuid
           AND workspace_id = ${ctx.workspaceId}::uuid
      `);

      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing',
        status: 'withdrawn',
        legalBasis: 'consent',
        scopeListId: input.listId,
        source: input.reason === 'one_click' ? 'one_click' : 'preference_center',
        tx,
      });
    }

    // Zrušení čekajících zpráv ve STEJNÉ transakci. listId se předává vždy,
    // i jako null, viz komentář u typu.
    await revokePendingMessages({
      workspaceId: ctx.workspaceId,
      contactIds: [input.contactId],
      listId: input.listId,
      reason: 'unsubscribed',
    });

    await emitWebhookEvent(tx, {
      workspaceId: ctx.workspaceId,
      type: 'contact.unsubscribed',
      occurredAt: new Date(),
      data: {
        contact_id: input.contactId,
        email,
        list_id: input.listId,
        scope: global ? 'global' : 'list',
        reason: input.reason,
      },
    });

    return { scope: global ? 'global' : 'list' };
  });
}

/**
 * Pozastavení odběru. Měkčí volba, kterou stránka předvoleb nabízí PŘED odhlášením,
 * protože ji většina lidí uvítá a projekt o kontakt nepřijde. Stav přihlášení
 * zůstává confirmed, jen se nastaví snooze_until.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POSTGRESQL. Plán skládal interval výrazem
 * `(${days} || ' days')::interval`. Vázaný parametr má v tom výrazu neznámý typ, takže
 * PostgreSQL odmítne operátor `||` chybou 42883 a pozastavení by nešlo vůbec. Interval
 * se proto skládá funkcí `make_interval`, která bere počet dní jako číslo.
 */
export async function snooze(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string | null; days: 30 | 60 | 90 },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE list_subscriptions
         SET snooze_until = now() + make_interval(days => ${input.days}), updated_at = now()
       WHERE contact_id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND (${input.listId}::uuid IS NULL OR list_id = ${input.listId}::uuid)
    `);
  });
}
