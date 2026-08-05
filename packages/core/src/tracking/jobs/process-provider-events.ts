import { sql } from 'drizzle-orm';
import { withTrackingTx } from '../repo/tx';
import { refreshDeliveryCounters } from './refresh-campaign-progress';
import { enqueueTrackingJob } from './enqueue';

export const PROCESS_PROVIDER_EVENTS_QUEUE = 'tracking.process_provider_events';

/** Náklad fronty. Jména polí odpovídají registru P01 (`payloadFields`). */
export type ProcessProviderEventsJobData = { workspaceId: string; eventIds: string[] };

/**
 * Zařazení přepočtu doručenosti po zápisu událostí od poskytovatele.
 *
 * Volá se odtamtud, kde se `message_events` typu `delivered`, `bounced_*`
 * nebo `complained` zapisují. Dnes je to jediné místo, kde by se to stalo:
 * zpracování SNS potvrzenky ve frontě `provider_event.process`, která obsluhu
 * nemá (viz report a `apps/worker/test/handler-coverage.test.ts`).
 */
export async function enqueueProcessProviderEvents(
  tx: Parameters<typeof enqueueTrackingJob>[0],
  data: ProcessProviderEventsJobData,
): Promise<void> {
  if (data.eventIds.length === 0) return;
  await enqueueTrackingJob(tx, PROCESS_PROVIDER_EVENTS_QUEUE, {
    workspaceId: data.workspaceId,
    eventIds: data.eventIds,
  });
}

/**
 * Obsluha fronty `tracking.process_provider_events`.
 *
 * Z dávky událostí zjistí, kterých KAMPANÍ se týkají, a u každé přepočítá
 * doručenost celou hodnotou. Přírůstek by tady byl chyba: poskytovatel doručí
 * tutéž událost víckrát a `delivered` je počet ZPRÁV, ne počet událostí, takže
 * druhé doručení téže notifikace by číslo zvedlo nad počet odeslaných.
 *
 * Přepočet je jeden agregační dotaz nad oddílem kampaně. Proti přírůstku stojí
 * pár set řádků navíc a získává se za to vlastnost, že se čísla nedají rozejít.
 */
export async function handleProcessProviderEvents(
  data: ProcessProviderEventsJobData,
): Promise<void> {
  if (data.eventIds.length === 0) return;

  const campaignIds = await withTrackingTx(
    { workspaceId: data.workspaceId, job: PROCESS_PROVIDER_EVENTS_QUEUE },
    async (tx) => {
      const { rows } = await tx.execute<{ campaignId: string }>(sql`
        SELECT DISTINCT campaign_id AS "campaignId"
          FROM message_events
         WHERE workspace_id = ${data.workspaceId}::uuid
           AND id = ANY(${sql.param([...data.eventIds])}::uuid[])
           AND received_at >= now() - interval '2 days'
      `);
      return rows.map((row) => row.campaignId);
    },
  );

  for (const campaignId of campaignIds) {
    await refreshDeliveryCounters({ workspaceId: data.workspaceId, campaignId });
  }
}
