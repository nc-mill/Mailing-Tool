import { describe, expect, it } from 'vitest';
import { ROLES, can, permissionsOf, rolesGranting } from './permissions';

describe('kontrakt matice 3.4 části 1, na kterém stojí navigace P06', () => {
  it('zná právě čtyři role v pořadí od nejsilnější', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });

  it('viewer nevidí žádnou sekci nastavení projektu kromě obecné', () => {
    expect(can('viewer', 'workspace:read')).toBe(true);
    expect(can('viewer', 'members:read')).toBe(false);
    expect(can('viewer', 'api_keys:read')).toBe(false);
    expect(can('viewer', 'webhooks:read')).toBe(false);
    expect(can('viewer', 'audit:read')).toBe(false);
  });

  it('editor vidí členy, ale nezve, a nevidí klíče ani audit', () => {
    expect(can('editor', 'members:read')).toBe(true);
    expect(can('editor', 'members:invite')).toBe(false);
    expect(can('editor', 'api_keys:read')).toBe(false);
    expect(can('editor', 'audit:read')).toBe(false);
    expect(can('editor', 'webhooks:read')).toBe(true);
    expect(can('editor', 'webhooks:write')).toBe(false);
  });

  it('admin nemůže smazat ani předat projekt', () => {
    expect(can('admin', 'workspace:update')).toBe(true);
    expect(can('admin', 'workspace:delete')).toBe(false);
    expect(can('admin', 'workspace:transfer')).toBe(false);
  });

  it('owner má všechno, co má admin, a navíc zálohy', () => {
    for (const permission of permissionsOf('admin')) {
      expect(can('owner', permission), `owner postrádá ${permission}`).toBe(true);
    }
    expect(can('owner', 'backups:read')).toBe(true);
    expect(can('admin', 'backups:read')).toBe(false);
  });

  it('rolesGranting vrátí role, které oprávnění mají, od nejslabší', () => {
    expect(rolesGranting('api_keys:read')).toEqual(['admin', 'owner']);
    expect(rolesGranting('workspace:delete')).toEqual(['owner']);
  });
});
