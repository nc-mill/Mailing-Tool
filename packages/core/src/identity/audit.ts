import { defineAuditActions } from '../audit/action';

/**
 * Auditní akce vlastněné doménou identity a platformy podle tabulky v 3.7.
 * Ostatní domény přidávají svoje do vlastního packages/core/src/<domena>/audit.ts.
 */
export const IdentityAuditActions = defineAuditActions([
  'user.login',
  'user.login_failed',
  'user.logout',
  'user.password_changed',
  'user.password_reset_requested',
  'user.password_reset_completed',
  'workspace.created',
  'workspace.updated',
  'workspace.deleted',
  'workspace.restored',
  'workspace.ownership_transferred',
  'member.invited',
  'member.invitation_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'api_key.created',
  'api_key.rotated',
  'api_key.revoked',
  'webhook_endpoint.created',
  'webhook_endpoint.updated',
  'webhook_endpoint.deleted',
  'webhook_endpoint.disabled',
  'settings.updated',
]);
