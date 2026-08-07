import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { loadConfig } from '../../config/index';
import { enqueueJob } from '../../queues/enqueue-sql';
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
 * Založí JEDNO doručení a zařadí ho k odeslání.
 *
 * VZNIKLO VYTAŽENÍM Z FAN-OUTU, aby cílené doručení testovací události mohlo
 * vynechat VÝBĚR PODLE ODBĚRU a nic víc. Všechno ostatní, co doručení dělá
 * doručením, je tady: řádek ve `webhook_deliveries` (tedy log doručení
 * i podklad pro ruční opakování), sdílené `created_at` kvůli idempotenci
 * i oddílu tabulky, a zařazení `platform.webhook_deliver`, které podepisuje
 * a opakuje. Kdyby si cílená cesta psala vlastní INSERT, měla by jinou obálku,
 * jiný podpis nebo by se neopakovala, a nikdo by si toho nevšiml.
 *
 * Vrací ID doručení, nebo `null`, když už takové doručení existuje.
 */
async function enqueueDelivery(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { eventId: string; eventType: string; endpointId: string; sharedCreatedAt: Date },
): Promise<string | null> {
  const id = uuidv7();
  const { rows: inserted } = await tx.execute<{ id: string }>(sql`
    INSERT INTO webhook_deliveries
      (id, workspace_id, endpoint_id, event_id, event_type, status, attempt, next_attempt_at, created_at)
    VALUES
      (${id}::uuid, ${ctx.workspaceId}::uuid, ${input.endpointId}::uuid, ${input.eventId}::uuid,
       ${input.eventType}, 'pending', 0, now(), ${input.sharedCreatedAt})
    ON CONFLICT (event_id, endpoint_id, created_at) DO NOTHING
    RETURNING id::text AS id
  `);
  if (inserted.length !== 1) return null;
  const deliveryId = inserted[0]!.id;

  /*
   * ZAŘAZENÍ DORUČENÍ. Tenhle článek řetězu CHYBĚL a stálo kvůli tomu celé
   * odchozí rozhraní: fan-out poctivě vyrobil řádky ve `webhook_deliveries`,
   * vrátil jejich ID a obsluha je zahodila. Do fronty `platform.webhook_deliver`
   * tedy nezařazoval nikdo, řádky zůstávaly navždy ve stavu `pending`
   * a obrazovka doručení přitom vypadala, že se doručuje.
   *
   * Zařazuje se v TÉŽE transakci jako INSERT, takže úloha nemůže přežít
   * rollback fan-outu ani se ztratit po něm.
   *
   * `onMerged: 'drop'` je záměr. Fronta má politiku `exclusive` a klíč je ID
   * doručení, takže se zahodí jedině DRUHÉ zařazení TÉHOŽ doručení, tedy souběh
   * s opakovacím skenem (`platform.webhook_retry`). Práce se tím neztrácí:
   * pravdu drží řádek ve `webhook_deliveries` a další pokus zařadí sken podle
   * `next_attempt_at`. `fail` by tu byl škodlivý, protože by kvůli neškodnému
   * souběhu shodil celou doménovou transakci, která událost vyrobila.
   */
  await enqueueJob(tx, {
    schema: loadConfig().PGBOSS_SCHEMA,
    name: 'platform.webhook_deliver',
    payload: {
      delivery_id: deliveryId,
      workspace_id: ctx.workspaceId,
      created_at: input.sharedCreatedAt.toISOString(),
    },
    singletonKey: `delivery:${deliveryId}`,
    onMerged: 'drop',
  });
  return deliveryId;
}

type EventRow = { id: string; type: string; created_at: Date };

/** Načte událost v téže transakci. `null` znamená, že událost neexistuje. */
async function loadEvent(tx: Tx, eventId: string): Promise<EventRow | null> {
  const { rows } = await tx.execute<EventRow>(sql`
    SELECT id::text AS id, type, created_at
      FROM webhook_events
     WHERE id = ${eventId}::uuid
     LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * CÍLENÉ DORUČENÍ NA JEDEN ENDPOINT, MIMO FAN-OUT.
 *
 * PROČ TO EXISTUJE. „Poslat testovací událost" míří na KONKRÉTNÍ endpoint,
 * takže mu má dorazit bez ohledu na to, co odebírá. Dosud šla i tahle cesta
 * fan-outem, který doručuje jen odběratelům daného typu, takže se ptala na
 * odběr, který s ní nemá co dělat. Projevovalo se to tím, že tlačítko
 * u endpointu založeného z rozhraní NIKDY NIC nedoručilo: typ `ping` se nedal
 * zaškrtnout, takže výběr podle odběru byl vždycky prázdný.
 *
 * VYNECHÁVÁ SE JEN VÝBĚR PODLE ODBĚRU, nic jiného. Podpis, opakování, log
 * doručení i idempotence jsou společné s fan-outem, viz `enqueueDelivery`.
 *
 * NA STAV ENDPOINTU SE NEHLEDÍ, jen na to, že není smazaný. Deaktivovaný
 * endpoint je přesně ten, u kterého má člověk největší důvod tlačítko zmáčknout:
 * chce zjistit, jestli jeho server zase odpovídá. Doručení samo stav nemění;
 * o zapnutí rozhoduje `enable`, ne test.
 */
export async function deliverEventToEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { eventId: string; endpointId: string },
): Promise<{ deliveryId: string | null }> {
  const event = await loadEvent(tx, input.eventId);
  if (!event) return { deliveryId: null };
  const deliveryId = await enqueueDelivery(tx, ctx, {
    eventId: event.id,
    eventType: event.type,
    endpointId: input.endpointId,
    sharedCreatedAt: new Date(event.created_at),
  });
  return { deliveryId };
}

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
    const event = await loadEvent(tx, eventId);
    if (!event) return { created: 0, deliveryIds: [] };

    const endpoints = await endpointsSubscribedTo(tx, ctx, event.type);
    if (endpoints.length === 0) return { created: 0, deliveryIds: [] };

    const sharedCreatedAt = new Date(event.created_at);
    const deliveryIds: string[] = [];

    for (const endpoint of endpoints) {
      const deliveryId = await enqueueDelivery(tx, ctx, {
        eventId,
        eventType: event.type,
        endpointId: endpoint.id,
        sharedCreatedAt,
      });
      if (deliveryId !== null) deliveryIds.push(deliveryId);
    }

    return { created: deliveryIds.length, deliveryIds };
  });
}
