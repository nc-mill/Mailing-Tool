import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';
import { endpointsSubscribedTo } from './endpoint-service';

export type EmitInput = {
  workspaceId: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
};

/**
 * 3.8: událost vzniká jednou (webhook_events), doručení je fan-out na každý
 * aktivní endpoint, který ji odebírá (webhook_deliveries).
 *
 * Zapisuje se ve stejné transakci jako doménová změna, takže rollback změny
 * zruší i událost. Fan-out pak provede job platform.webhook_fanout.
 */
export async function emitWebhookEvent(tx: Tx, input: EmitInput): Promise<string> {
  const id = uuidv7();
  await tx.insert(schema.webhookEvents).values({
    id,
    workspaceId: input.workspaceId,
    type: input.type,
    payload: input.data as never,
    occurredAt: input.occurredAt,
  });
  return id;
}

export type FanoutResult = { created: number; deliveryIds: string[] };

/**
 * Idempotentní fan-out. pg-boss job se podle 9.1 může spustit znovu i po
 * částečném běhu, takže druhý běh nesmí vyrobit druhou sadu doručení.
 *
 * Unikátní index uq_webhook_deliveries__event_endpoint obsahuje i created_at,
 * protože tabulka je partitionovaná. Fan-out proto musí použít JEDNU hodnotu
 * created_at pro všechna doručení jedné události.
 *
 * ODCHYLKA OD PLÁNU, a je to oprava, ne kosmetika. Plán bral `new Date()`
 * ("sharedCreatedAt") a tím si vlastní idempotenci vyvrátil: hodnota je sice
 * jedna pro celý běh, ale při DRUHÉM běhu jobu je jiná, takže by
 * `ON CONFLICT (event_id, endpoint_id, created_at)` nikdy nesepnul a příjemce
 * by dostal webhook dvakrát. Hodnota se proto přebírá z `webhook_events.created_at`,
 * což je zároveň to, co u sloupce výslovně předepisuje P03 (rozhodnutí R22)
 * a proč u něj schválně chybí DEFAULT now(). Vedlejším efektem je, že doručení
 * leží ve stejném měsíčním oddílu jako událost.
 *
 * Druhá oprava: plán uvnitř SQL používal neexistující proměnnou `workspaceId`.
 * Správně je `ctx.workspaceId`; jinak by dotaz spadl na ReferenceError.
 */
export async function fanoutEvent(ctx: WorkspaceContext, eventId: string): Promise<FanoutResult> {
  return withWorkspace(ctx, async (tx) => {
    const { rows: events } = await tx.execute<{ id: string; type: string; created_at: Date }>(sql`
      SELECT id::text AS id, type, created_at
        FROM webhook_events
       WHERE id = ${eventId}::uuid
       LIMIT 1
    `);
    const event = events[0];
    if (!event) return { created: 0, deliveryIds: [] };

    const endpoints = await endpointsSubscribedTo(tx, ctx, event.type);
    if (endpoints.length === 0) return { created: 0, deliveryIds: [] };

    const sharedCreatedAt = new Date(event.created_at);
    const deliveryIds: string[] = [];

    for (const endpoint of endpoints) {
      const id = uuidv7();
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO webhook_deliveries
          (id, workspace_id, endpoint_id, event_id, event_type, status, attempt, next_attempt_at, created_at)
        VALUES
          (${id}::uuid, ${ctx.workspaceId}::uuid, ${endpoint.id}::uuid, ${eventId}::uuid, ${event.type},
           'pending', 0, now(), ${sharedCreatedAt})
        ON CONFLICT (event_id, endpoint_id, created_at) DO NOTHING
        RETURNING id::text AS id
      `);
      if (inserted.length === 1) deliveryIds.push(inserted[0]!.id);
    }

    return { created: deliveryIds.length, deliveryIds };
  });
}
