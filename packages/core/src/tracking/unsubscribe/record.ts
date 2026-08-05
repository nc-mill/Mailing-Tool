import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { trackingLogger } from '../logging';
import { withTrackingTx } from '../repo/tx';
import { refreshDeliveryCounters } from '../jobs/refresh-campaign-progress';

/**
 * Zápis odhlášení jako události kampaně.
 *
 * PROČ TO VŮBEC EXISTUJE. Odhlášení se do teď zapsalo jedině do
 * `list_subscriptions.status`, což je stav odběru, ne událost kampaně. Report
 * kampaně čte `campaign_stats.unsubscribed`, které se počítá z `message_events`
 * typu `unsubscribe`, a ty nikdo nezapisoval. Zadavatel se prokazatelně odhlásil
 * z odkazu v kampani, v datech to bylo vidět, a ve statistice kampaně stála
 * nula. Chyběl přesně tenhle řádek.
 *
 * Kampaň se NEHÁDÁ. Odhlašovací token nese `message_id` a `message_created_at`,
 * tedy obě složky primárního klíče zprávy, a z té zprávy se čte `campaign_id`.
 * Odhlášení iniciované jinak než odkazem v e-mailu (rozhraní správce, API,
 * import) žádnou zprávu nemá, takže se žádné kampani nepřipíše, a je to správně.
 *
 * `recipient` se nevyplňuje: `ck_message_events__recipient` ho vyžaduje jen
 * u doručovacích typů. E-mailová adresa na řádku události by musela projít
 * výmazem podle článku 17 a nic navíc by neřekla.
 */
export type RecordUnsubscribeInput = {
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  contactId: string;
};

export type RecordUnsubscribeResult = { campaignId: string | null; recorded: boolean };

export async function recordCampaignUnsubscribe(
  input: RecordUnsubscribeInput,
): Promise<RecordUnsubscribeResult> {
  const campaignId = await withTrackingTx(
    { workspaceId: input.workspaceId, job: 'tracking.record_unsubscribe' },
    async (tx) => {
      const { rows: messages } = await tx.execute<{
        campaignId: string | null;
        createdAt: Date;
      }>(sql`
        SELECT campaign_id AS "campaignId", created_at AS "createdAt"
          FROM messages
         WHERE id = ${input.messageId}::uuid
           AND workspace_id = ${input.workspaceId}::uuid
           -- Sekundová tolerance: token nese message_created_at v celých
           -- sekundách, kdežto sloupec má mikrosekundy.
           AND created_at >= ${input.messageCreatedAt}::timestamptz - interval '1 second'
           AND created_at <  ${input.messageCreatedAt}::timestamptz + interval '2 seconds'
         LIMIT 1
      `);
      const message = messages[0];
      if (message === undefined || message.campaignId === null) return null;

      // Idempotence: druhé kliknutí na tentýž odkaz nesmí vyrobit druhý řádek.
      // Sloupec unsubscribed se počítá jako count(DISTINCT message_id), takže
      // by duplicita číslo nezvedla, ale v časové ose kontaktu by se objevila
      // dvakrát a to je zbytečný zmatek.
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO message_events (
          id, workspace_id, message_id, message_created_at, campaign_id,
          contact_id, type, ts, source, metadata)
        SELECT ${uuidv7()}::uuid, ${input.workspaceId}::uuid, ${input.messageId}::uuid,
               ${message.createdAt}, ${message.campaignId}::uuid, ${input.contactId}::uuid,
               'unsubscribe', now(), 'tracking', '{}'::jsonb
         WHERE NOT EXISTS (
                 SELECT 1 FROM message_events e
                  WHERE e.workspace_id = ${input.workspaceId}::uuid
                    AND e.message_id = ${input.messageId}::uuid
                    AND e.type = 'unsubscribe')
        RETURNING id
      `);
      void inserted;
      return message.campaignId;
    },
  );

  if (campaignId === null) return { campaignId: null, recorded: false };

  // Přepočet doručenosti hned, ne až za třicet sekund cronem. Odhlášení je
  // ojedinělá událost a uživatel po něm do reportu kouká.
  await refreshDeliveryCounters({ workspaceId: input.workspaceId, campaignId });

  trackingLogger().debug(
    { workspace_id: input.workspaceId, campaign_id: campaignId },
    'odhlášení připsáno kampani',
  );
  return { campaignId, recorded: true };
}
