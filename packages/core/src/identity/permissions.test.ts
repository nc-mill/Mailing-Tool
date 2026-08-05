import { describe, it, expect } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { ApiError } from '../errors/api-error';
import {
  PERMISSIONS,
  ROLE_ORDER,
  ROLE_PERMISSIONS,
  assertPermission,
  roleHasPermission,
  rolesGranting,
} from './permissions';
import type { WorkspaceContext } from './types';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';

const ctxFor = (role: 'owner' | 'admin' | 'editor' | 'viewer'): WorkspaceContext =>
  unsafeWorkspaceContext(WS, {
    type: 'user',
    userId: '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071',
    role,
  });

const keyCtx = (scopes: string[]): WorkspaceContext =>
  unsafeWorkspaceContext(WS, { type: 'api_key', apiKeyId: 'k', scopes });

describe('matice oprávnění 3.4', () => {
  // 48 ze specifikace plus `transactional:send` pro transakční API.
  it('má přesně 49 oprávnění', () => {
    expect(PERMISSIONS.length).toBe(49);
    expect(new Set(PERMISSIONS).size).toBe(49);
  });

  it('každé oprávnění má tvar resource:action', () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it('počty na roli sedí s tabulkou', () => {
    expect(ROLE_PERMISSIONS.owner.length).toBe(49);
    expect(ROLE_PERMISSIONS.admin.length).toBe(44);
    expect(ROLE_PERMISSIONS.editor.length).toBe(29);
    expect(ROLE_PERMISSIONS.viewer.length).toBe(12);
  });

  it('role jsou vnořené, každá vyšší umí všechno, co nižší', () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(ROLE_PERMISSIONS.editor).toContain(p);
    for (const p of ROLE_PERMISSIONS.editor) expect(ROLE_PERMISSIONS.admin).toContain(p);
    for (const p of ROLE_PERMISSIONS.admin) expect(ROLE_PERMISSIONS.owner).toContain(p);
  });

  it('tři netriviální řádky ze specifikace', () => {
    // Export je jednorázový odnos celé databáze kontaktů, editor ho nemá.
    expect(roleHasPermission('editor', 'contacts:export')).toBe(false);
    expect(roleHasPermission('admin', 'contacts:export')).toBe(true);
    // Bez campaigns:send by editor čekal u každé kampaně na admina.
    expect(roleHasPermission('editor', 'campaigns:send')).toBe(true);
    // Záloha obsahuje data všech kontaktů projektu a metadata instalace.
    expect(roleHasPermission('admin', 'backups:run')).toBe(false);
    expect(roleHasPermission('owner', 'backups:run')).toBe(true);
  });

  it('gdpr:erase a workspace:delete má jen owner', () => {
    expect(roleHasPermission('admin', 'gdpr:erase')).toBe(false);
    expect(roleHasPermission('admin', 'workspace:delete')).toBe(false);
    expect(roleHasPermission('admin', 'workspace:transfer')).toBe(false);
  });

  it('viewer čte, ale nezapisuje nic', () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(p.endsWith(':read')).toBe(true);
  });

  it('rolesGranting vrací role od nejslabší, protože klient nabízí nejnižší dostačující', () => {
    expect(rolesGranting('campaigns:write')).toEqual(['editor', 'admin', 'owner']);
    expect(rolesGranting('contacts:export')).toEqual(['admin', 'owner']);
    expect(rolesGranting('gdpr:erase')).toEqual(['owner']);
    expect(rolesGranting('workspace:read')).toEqual([...ROLE_ORDER]);
  });

  it('rolesGranting je odvozený z matice, ne psaný ručně', () => {
    // Kdyby se seznam psal zvlášť, rozešel by se s maticí a chyba by se
    // projevila jen tím, že hláška radí špatnou roli.
    for (const permission of PERMISSIONS) {
      const granting = rolesGranting(permission);
      expect(granting.length, `${permission} nemá žádnou roli`).toBeGreaterThan(0);
      for (const role of ROLE_ORDER) {
        expect(granting.includes(role)).toBe(roleHasPermission(role, permission));
      }
    }
  });
});

describe('assertPermission', () => {
  it('uživatel s rolí projde', () => {
    expect(() => assertPermission(ctxFor('admin'), 'api_keys:write')).not.toThrow();
  });

  it('uživatel bez oprávnění dostane forbidden 403', () => {
    try {
      assertPermission(ctxFor('viewer'), 'campaigns:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('forbidden');
      expect(err.status).toBe(403);
    }
  });

  it('forbidden nese data, podle kterých jde radu splnit', () => {
    // Rada „požádejte kolegu o vyšší roli" je bez těchhle polí nesplnitelná:
    // obrazovka by neuměla říct ani co chybí, ani kdo to má.
    try {
      assertPermission(ctxFor('viewer'), 'contacts:export');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).params).toMatchObject({
        requiredPermission: 'contacts:export',
        currentRole: 'viewer',
        grantedByRoles: ['admin', 'owner'],
      });
    }
  });

  it('insufficient_scope řekne, které oprávnění klíči chybí a která má', () => {
    try {
      assertPermission(keyCtx(['events:write']), 'contacts:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).params).toMatchObject({
        requiredPermission: 'contacts:write',
        grantedScopes: ['events:write'],
      });
    }
  });

  it('API klíč se scope projde', () => {
    expect(() => assertPermission(keyCtx(['contacts:write']), 'contacts:write')).not.toThrow();
  });

  it('API klíč bez scope dostane insufficient_scope 403, ne forbidden', () => {
    try {
      assertPermission(keyCtx(['events:write']), 'contacts:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('insufficient_scope');
      expect(err.status).toBe(403);
    }
  });

  it('u API klíče se role neuplatňuje, jeho oprávnění jsou přesně jeho scopes', () => {
    expect(() => assertPermission(keyCtx([]), 'workspace:read')).toThrow(ApiError);
  });

  it('wildcard * není oprávnění a nikdy neprojde', () => {
    expect(() => assertPermission(keyCtx(['*']), 'contacts:write')).toThrow(ApiError);
    expect(PERMISSIONS).not.toContain('*' as never);
  });

  it('systémový aktér projde vždy, protože běží mimo request', () => {
    const sys = unsafeWorkspaceContext(WS, { type: 'system', job: 'platform.webhook_deliver' });
    expect(() => assertPermission(sys, 'webhooks:write')).not.toThrow();
  });
});
