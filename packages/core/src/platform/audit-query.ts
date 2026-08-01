import { sql } from 'drizzle-orm';
import type { Tx } from '../tx';
import type { WorkspaceContext } from '../identity/types';

/** 4.3: každý zdroj vyjmenovává povolené hodnoty order, jinak stránkování zpomalí. */
export const AUDIT_ORDERS = ['created_at.desc', 'created_at.asc'] as const;

export type AuditFilters = {
  action?: string | undefined;
  actorId?: string | undefined;
  targetId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export type AuditListQuery = AuditFilters & {
  limit: number;
  order: string;
  cursor: { k: unknown[] } | null;
};

export type AuditRow = {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function filterSql(filters: AuditFilters) {
  return sql`
    ${filters.action ? sql`AND action = ${filters.action}` : sql``}
    ${filters.actorId ? sql`AND actor_id = ${filters.actorId}::uuid` : sql``}
    ${filters.targetId ? sql`AND target_id = ${filters.targetId}::uuid` : sql``}
    ${filters.from ? sql`AND created_at >= ${filters.from}::timestamptz` : sql``}
    ${filters.to ? sql`AND created_at < ${filters.to}::timestamptz` : sql``}
  `;
}

/**
 * 3.7: čtení je projektové. Globální řádky (workspace_id IS NULL) se přes
 * workspace kontext nečtou vůbec, patří uživateli, ne projektu. Zajišťuje to
 * politika ws_isolation_audit, tenhle dotaz se na ni spoléhá jako na druhou
 * vrstvu a filtr podle workspace má i sám v sobě.
 */
export async function listAuditLog(
  tx: Tx,
  ctx: WorkspaceContext,
  query: AuditListQuery,
): Promise<AuditRow[]> {
  const descending = query.order !== 'created_at.asc';
  const keyset = query.cursor
    ? descending
      ? sql`AND (created_at, id) < (${query.cursor.k[0]}::timestamptz, ${query.cursor.k[1]}::uuid)`
      : sql`AND (created_at, id) > (${query.cursor.k[0]}::timestamptz, ${query.cursor.k[1]}::uuid)`
    : sql``;
  const order = descending
    ? sql`ORDER BY created_at DESC, id DESC`
    : sql`ORDER BY created_at ASC, id ASC`;

  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, action, actor_type, actor_id::text AS actor_id, actor_label,
           target_type, target_id::text AS target_id, host(ip) AS ip, request_id, metadata, created_at
      FROM audit_log
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${filterSql(query)} ${keyset}
     ${order}
     LIMIT ${query.limit + 1}
  `);

  return rows.map((r) => ({
    id: r['id'] as string,
    action: r['action'] as string,
    actor_type: r['actor_type'] as string,
    actor_id: (r['actor_id'] as string | null) ?? null,
    actor_label: r['actor_label'] as string,
    target_type: (r['target_type'] as string | null) ?? null,
    target_id: (r['target_id'] as string | null) ?? null,
    ip: (r['ip'] as string | null) ?? null,
    request_id: (r['request_id'] as string | null) ?? null,
    metadata: (r['metadata'] as Record<string, unknown>) ?? {},
    created_at: new Date(r['created_at'] as Date).toISOString(),
  }));
}

export async function countAuditLog(
  tx: Tx,
  ctx: WorkspaceContext,
  filters: AuditFilters,
): Promise<{
  count: number;
  precision: 'exact' | 'estimated';
  computed_at: string;
  stale: boolean;
}> {
  const computedAt = new Date().toISOString();
  const { rows } = await tx.execute<{ count: string }>(sql`
    SELECT count(*) AS count FROM audit_log
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${filterSql(filters)}
  `);
  return {
    count: Number(rows[0]!.count),
    precision: 'exact',
    computed_at: computedAt,
    stale: false,
  };
}

/** Odkaz na řádek partitionovaného audit logu nese obě složky klíče (2.1). */
export function auditKeys(row: AuditRow): unknown[] {
  return [row.created_at, row.id];
}
