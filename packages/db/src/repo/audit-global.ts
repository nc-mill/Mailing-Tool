// packages/db/src/repo/audit-global.ts
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { withUser } from './tx';

export type GlobalAuditRow = {
  id: string;
  action: string;
  actorLabel: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

/**
 * JEDINÁ cesta ke globálním auditním záznamům (workspace_id IS NULL).
 *
 * Politika ws_isolation_audit je pro čtení schválně přísná a globální řádky
 * přes workspace kontext nepouští: patří uživateli, ne projektu. Kdyby je USING
 * pustilo, viděl by admin projektu A přihlášení uživatelů projektu B.
 *
 * GET /api/v1/audit-log je projektový a globální řádky nevrací vůbec.
 */
export async function listGlobalAuditForUser(
  pool: Pool,
  userId: string,
  limit = 50,
): Promise<GlobalAuditRow[]> {
  return withUser(pool, userId, async (tx) => {
    const { rows } = await tx.execute<GlobalAuditRow>(
      sql`SELECT id, action, actor_label AS "actorLabel", ip,
              user_agent AS "userAgent", created_at AS "createdAt"
         FROM audit_log
        WHERE workspace_id IS NULL AND actor_type = 'user' AND actor_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
    );
    return rows;
  });
}
