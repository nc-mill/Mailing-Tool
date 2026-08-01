import { defineAuditActions } from '../audit/action';
import { writeAuditLog } from '../audit/write';
import { actorInfo } from '../identity/types';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Auditní akce vlastněné segmenty. Konvence je `<entita>.<sloveso v minulém čase>`.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal `writeAudit(ctx, {...})`
 * bez transakce a se sdíleným typem akcí. P01 sdílený union vědomě nezaložil
 * (byl by to konflikt v každém z šestnácti plánů) a `writeAuditLog` bere `tx`
 * jako první argument, protože audit se zapisuje ve STEJNÉ transakci jako
 * auditovaná změna. Jedinečnost napříč doménami hlídá `audit-actions.test.ts`.
 */
export const SEGMENTS_AUDIT_ACTIONS = [
  'segment.created',
  'segment.updated',
  'segment.deleted',
  'segment.frozen',
] as const;

export type SegmentAuditAction = (typeof SEGMENTS_AUDIT_ACTIONS)[number];

export const SegmentsAuditActions = defineAuditActions(SEGMENTS_AUDIT_ACTIONS);

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

export async function auditSegment(
  tx: Tx,
  ctx: WorkspaceContext,
  action: SegmentAuditAction,
  segmentId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await writeAuditLog(tx, {
    action: SegmentsAuditActions[action],
    workspaceId: ctx.workspaceId,
    actor: actorInfo(ctx.actor, actorLabelOf(ctx)),
    targetType: 'segment',
    targetId: segmentId,
    metadata,
  });
}

/**
 * `created_by` je `uuid` a systémový aktér uživatele nemá. Bez tohohle překladu
 * by se do sloupce dostalo jméno jobu, tedy `'segments.recount'`, a zápis by
 * skončil `22P02 invalid input syntax for type uuid`. Zrádné je, že přes
 * obrazovku se to nikdy neprojeví: uživatel má `type: 'user'` a UUID tam sedí.
 * Spadne to teprve při prvním běhu jobu, tedy až v provozu.
 */
export function actorUserId(ctx: WorkspaceContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.userId : null;
}
