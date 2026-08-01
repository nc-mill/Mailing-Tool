import { defineAuditActions } from '../../audit/action';
import { writeAuditLog } from '../../audit/write';
import { actorInfo } from '../../identity/types';
import type { WorkspaceContext } from '../../identity/types';
import type { Tx } from '../../tx';

/**
 * Auditní akce vlastněné importem a exportem.
 *
 * ODCHYLKA OD PLÁNU: plán měl v tomhle seznamu i `name_override.created`
 * a `contact.vocative_bulk_confirmed`. Obě už deklaruje `contacts/audit.ts`
 * (P07 je vlastní po rozhodnutí U3) a `audit-actions.test.ts` opakování názvu
 * ve dvou doménách zakazuje mechanicky, takže by sada spadla.
 *
 * Druhá odchylka je tvar zápisu: `writeAuditLog` bere `tx` jako první argument,
 * protože audit se zapisuje ve STEJNÉ transakci jako auditovaná změna.
 */
export const IMPORT_AUDIT_ACTIONS = [
  'import.confirmed',
  'import.cancelled',
  'export.created',
  'export.downloaded',
] as const;

export type ImportAuditAction = (typeof IMPORT_AUDIT_ACTIONS)[number];

export const ImportAuditActions = defineAuditActions(IMPORT_AUDIT_ACTIONS);

function actorLabelOf(ctx: WorkspaceContext): string {
  switch (ctx.actor.type) {
    case 'user':
      return ctx.actor.userId;
    case 'api_key':
      return `api_key:${ctx.actor.apiKeyId}`;
    case 'system':
      return ctx.actor.job;
  }
}

export async function auditImport(
  tx: Tx,
  ctx: WorkspaceContext,
  action: ImportAuditAction,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await writeAuditLog(tx, {
    action: ImportAuditActions[action],
    workspaceId: ctx.workspaceId,
    actor: actorInfo(ctx.actor, actorLabelOf(ctx)),
    targetType: action.startsWith('export.') ? 'export' : 'import',
    targetId: entityId,
    metadata,
  });
}

/**
 * `created_by` je `uuid` a systémový aktér uživatele nemá. Bez tohohle překladu
 * by se do sloupce dostalo jméno jobu a zápis by skončil `22P02`.
 */
export function actorUserId(ctx: WorkspaceContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.userId : null;
}
