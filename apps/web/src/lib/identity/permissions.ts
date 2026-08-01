import { ROLE_PERMISSIONS, type Permission } from '@mlain/core/identity/permissions';
import type { Role } from '@mlain/core/identity/types';

/** Od nejsilnější k nejslabší, pořadí je závazné pro řazení v rozhraní. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const satisfies readonly Role[];

export type { Permission, Role };

export function permissionsOf(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Role, které dané oprávnění mají, od nejslabší. Používá se v hlášce 22
 * z 10.3 části 6: „vyžaduje oprávnění X, které mají role Editor a výš".
 */
export function rolesGranting(permission: Permission): Role[] {
  return [...ROLES].reverse().filter((role) => can(role, permission));
}
