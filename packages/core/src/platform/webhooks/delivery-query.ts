import { sql } from 'drizzle-orm';
import type { Tx } from '../../tx';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';

export type PublicDelivery = {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempt: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body_snippet: string | null;
  duration_ms: number | null;
  error_code: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type DeliveryFilters = {
  endpointId?: string | undefined;
  eventType?: string | undefined;
  status?: string | undefined;
  limit: number;
  cursor: { k: unknown[] } | null;
};

/** Odkaz na řádek partitionované tabulky nese obě složky klíče (2.1). */
export function deliveryKeys(row: PublicDelivery): unknown[] {
  return [row.created_at, row.id];
}

export async function listDeliveries(
  tx: Tx,
  ctx: WorkspaceContext,
  filters: DeliveryFilters,
): Promise<PublicDelivery[]> {
  const keyset = filters.cursor
    ? sql`AND (created_at, id) < (${filters.cursor.k[0]}::timestamptz, ${filters.cursor.k[1]}::uuid)`
    : sql``;
  const byEndpoint = filters.endpointId
    ? sql`AND endpoint_id = ${filters.endpointId}::uuid`
    : sql``;
  const byType = filters.eventType ? sql`AND event_type = ${filters.eventType}` : sql``;
  const byStatus = filters.status ? sql`AND status = ${filters.status}` : sql``;

  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, endpoint_id::text AS endpoint_id, event_id::text AS event_id,
           event_type, status, attempt, next_attempt_at, response_status,
           response_body_snippet, duration_ms, error_code, delivered_at, created_at
      FROM webhook_deliveries
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${byEndpoint} ${byType} ${byStatus} ${keyset}
     ORDER BY created_at DESC, id DESC
     LIMIT ${filters.limit + 1}
  `);

  return rows.map((r) => ({
    id: r.id as string,
    endpoint_id: r.endpoint_id as string,
    event_id: r.event_id as string,
    event_type: r.event_type as string,
    status: r.status as string,
    attempt: Number(r.attempt),
    next_attempt_at: r.next_attempt_at ? new Date(r.next_attempt_at as Date).toISOString() : null,
    response_status: r.response_status === null ? null : Number(r.response_status),
    response_body_snippet: (r.response_body_snippet as string | null) ?? null,
    duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
    error_code: (r.error_code as string | null) ?? null,
    delivered_at: r.delivered_at ? new Date(r.delivered_at as Date).toISOString() : null,
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

/** Ruční opakování: doručení se vrátí na pending s okamžitým next_attempt_at. */
export async function retryDelivery(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    UPDATE webhook_deliveries
       SET status = 'pending', next_attempt_at = now(), error_code = NULL
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
       AND status IN ('failed','abandoned')
     RETURNING id
  `);
  if (rows.length === 0) throw new ApiError('not_found');
}
