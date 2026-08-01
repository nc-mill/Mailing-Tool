import * as schema from '@mlain/db/schema';
import type { Tx } from '../tx';
import type { AuditAction } from './action';
import { redactMetadata } from './redact';

export type AuditActorInfo = {
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
};

export type AuditEntry = {
  action: AuditAction;
  /**
   * NULL u globálních akcí (user.login, user.password_changed), které k žádnému
   * projektu nepatří. Politika ws_isolation_audit má NULL ve WITH CHECK povolený
   * právě proto, viz 3.6 a kritérium 21b.
   */
  workspaceId: string | null;
  actor: AuditActorInfo;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * 3.7: audit se zapisuje synchronně ve stejné transakci jako auditovaná změna.
 * Když se transakce rollbackne, záznam zmizí s ní, což je správně.
 *
 * Výjimka je `user.login_failed`, který se zapisuje mimo transakci, protože
 * k žádné změně nedochází; volající pro něj otevře vlastní `withoutContext`.
 */
export async function writeAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLog).values({
    workspaceId: entry.workspaceId,
    actorType: entry.actor.actorType,
    actorId: entry.actor.actorId,
    // Zmrazený text, ne odkaz: po smazání uživatele musí audit dál dávat smysl (6).
    actorLabel: entry.actor.actorLabel,
    action: String(entry.action),
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
    metadata: redactMetadata(entry.metadata ?? {}) as Record<string, unknown> as never,
  });
}
