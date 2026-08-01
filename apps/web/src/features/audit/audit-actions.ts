/**
 * Akce vlastněné částí 1 podle tabulky v její 3.7. Mapa je explicitní, aby se
 * překladový klíč neskládal za běhu (kritérium 71 části 6). Akce ostatních
 * domén se zobrazují jako kód, protože jejich texty by musely do `settings.json`,
 * který vlastní P06, a dva zapisovatelé do jednoho katalogu jsou konflikt.
 */
export const AUDIT_ACTION_KEYS = {
  'user.login': 'audit.actions.user.login',
  'user.login_failed': 'audit.actions.user.login_failed',
  'user.logout': 'audit.actions.user.logout',
  'user.password_changed': 'audit.actions.user.password_changed',
  'user.password_reset_requested': 'audit.actions.user.password_reset_requested',
  'user.password_reset_completed': 'audit.actions.user.password_reset_completed',
  'workspace.created': 'audit.actions.workspace.created',
  'workspace.updated': 'audit.actions.workspace.updated',
  'workspace.deleted': 'audit.actions.workspace.deleted',
  'workspace.restored': 'audit.actions.workspace.restored',
  'workspace.ownership_transferred': 'audit.actions.workspace.ownership_transferred',
  'member.invited': 'audit.actions.member.invited',
  'member.invitation_revoked': 'audit.actions.member.invitation_revoked',
  'member.joined': 'audit.actions.member.joined',
  'member.role_changed': 'audit.actions.member.role_changed',
  'member.removed': 'audit.actions.member.removed',
  'api_key.created': 'audit.actions.api_key.created',
  'api_key.rotated': 'audit.actions.api_key.rotated',
  'api_key.revoked': 'audit.actions.api_key.revoked',
  'webhook_endpoint.created': 'audit.actions.webhook_endpoint.created',
  'webhook_endpoint.updated': 'audit.actions.webhook_endpoint.updated',
  'webhook_endpoint.deleted': 'audit.actions.webhook_endpoint.deleted',
  'webhook_endpoint.disabled': 'audit.actions.webhook_endpoint.disabled',
  'backup.created': 'audit.actions.backup.created',
  'backup.restored': 'audit.actions.backup.restored',
  'settings.updated': 'audit.actions.settings.updated',
} as const;

export type KnownAuditAction = keyof typeof AUDIT_ACTION_KEYS;

export function isKnownAuditAction(action: string): action is KnownAuditAction {
  return Object.hasOwn(AUDIT_ACTION_KEYS, action);
}

export function auditActionKey(action: string): string | undefined {
  return isKnownAuditAction(action) ? AUDIT_ACTION_KEYS[action] : undefined;
}
