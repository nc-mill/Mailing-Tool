import type { Role } from '@/lib/identity/permissions';

/** Explicitní mapa, aby se překladový klíč nikdy neskládal za běhu. */
export const ROLE_LABEL_KEYS = {
  owner: 'shared.role.owner',
  admin: 'shared.role.admin',
  editor: 'shared.role.editor',
  viewer: 'shared.role.viewer',
} as const satisfies Record<Role, string>;

export function isRole(value: string | undefined): value is Role {
  return value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer';
}
