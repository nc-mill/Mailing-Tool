import { ApiError } from '../errors/api-error';
import type { Role, WorkspaceContext } from './types';

/**
 * Úplná matice ze 3.4. Oprávnění je řetězec `resource:action` a API klíč nese
 * scopes ze STEJNÉHO jmenného prostoru. Wildcard `*` nepovolujeme: klíč s `*`
 * je klíč, o kterém nikdo neví, co smí.
 */
export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer',
  'members:read',
  'members:invite',
  'members:update_role',
  'members:remove',
  'api_keys:read',
  'api_keys:write',
  'providers:read',
  'providers:write',
  'domains:read',
  'domains:write',
  'contacts:read',
  'contacts:write',
  'contacts:delete',
  'contacts:export',
  'contacts:import',
  'lists:read',
  'lists:write',
  'segments:read',
  'segments:write',
  'suppressions:read',
  'suppressions:write',
  'templates:read',
  'templates:write',
  'assets:read',
  'assets:write',
  'campaigns:read',
  'campaigns:write',
  'campaigns:send',
  'campaigns:control',
  'campaigns:delete',
  /**
   * Odeslání JEDNÉ transakční zprávy přes API. Schválně to není `campaigns:send`:
   * ten gatuje i pozastavení, obnovení, zrušení a vzetí zpět, takže klíč
   * v aplikaci zákazníka, který má poslat reset hesla, by uměl zastavit
   * běžící rozesílku. Jméno nekopíruje `messages:send`, protože `messages`
   * je v produktu název outboxové tabulky a pletlo by se to.
   */
  'transactional:send',
  'forms:read',
  'forms:write',
  'events:write',
  'reports:read',
  'timeline:read',
  'webhooks:read',
  'webhooks:write',
  'ai:use',
  'ai:configure',
  'audit:read',
  'backups:read',
  'backups:run',
  'gdpr:export',
  'gdpr:erase',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Vše, co smí viewer. Čtení a nic víc. */
const VIEWER: readonly Permission[] = [
  'workspace:read',
  'domains:read',
  'contacts:read',
  'lists:read',
  'segments:read',
  'suppressions:read',
  'templates:read',
  'assets:read',
  'campaigns:read',
  'forms:read',
  'reports:read',
  'timeline:read',
];

/** Editor tvoří obsah a kampaně. Neodnáší PII a nemění odesílací provider. */
const EDITOR_EXTRA: readonly Permission[] = [
  'members:read',
  'providers:read',
  'contacts:write',
  'contacts:delete',
  'contacts:import',
  'lists:write',
  'segments:write',
  'templates:write',
  'assets:write',
  'campaigns:write',
  'campaigns:send',
  'campaigns:control',
  'transactional:send',
  'forms:write',
  'events:write',
  'webhooks:read',
  'ai:use',
];

/** Admin spravuje přístupy a konfiguraci, nemaže ani nepředává projekt. */
const ADMIN_EXTRA: readonly Permission[] = [
  'workspace:update',
  'members:invite',
  'members:update_role',
  'members:remove',
  'api_keys:read',
  'api_keys:write',
  'providers:write',
  'domains:write',
  'contacts:export',
  'suppressions:write',
  'campaigns:delete',
  'webhooks:write',
  'ai:configure',
  'audit:read',
  'gdpr:export',
];

/** Owner navíc drží nevratné a celoprojektové operace. */
const OWNER_EXTRA: readonly Permission[] = [
  'workspace:delete',
  'workspace:transfer',
  'backups:read',
  'backups:run',
  'gdpr:erase',
];

const editor = [...VIEWER, ...EDITOR_EXTRA];
const admin = [...editor, ...ADMIN_EXTRA];
const owner = [...admin, ...OWNER_EXTRA];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  editor,
  admin,
  owner,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Role od nejslabší k nejsilnější. Pořadí je součástí odpovědi, ne jen detail. */
export const ROLE_ORDER: readonly Role[] = ['viewer', 'editor', 'admin', 'owner'];

/**
 * Které role dané oprávnění mají. Vrací se v odpovědi `forbidden`, aby klient
 * mohl říct „tohle umí admin a výš", ne jen „nemáte oprávnění".
 */
export function rolesGranting(permission: Permission): Role[] {
  return ROLE_ORDER.filter((role) => roleHasPermission(role, permission));
}

/**
 * Jediná kontrola oprávnění v celém produktu (3.4).
 *
 * Rozdíl mezi forbidden a insufficient_scope je záměrný a klient se podle něj
 * rozhoduje jinak: u forbidden má požádat kolegu o vyšší roli, u insufficient_scope
 * má vydat nový klíč s potřebným scope.
 *
 * Obojí proto NESE DATA, podle kterých se ta rada dá splnit. Dřívější znění
 * posílalo jen `permission`, takže obrazovka mohla napsat pouze „nemáte
 * oprávnění", a rada „požádejte kolegu" byla nesplnitelná: klient neměl jak
 * zjistit, koho požádat ani o co. `ForbiddenState` v P05 čte přesně tahle pole
 * a katalog hlášek z nich skládá větu.
 *
 * `contactableMembers` tady schválně NENÍ: vyžaduje dotaz do databáze a tahle
 * funkce je čistá a synchronní. Doplňuje ho `enrichForbidden` v úkolu 32,
 * a jen tomu, kdo smí členy vidět.
 */
export function assertPermission(ctx: WorkspaceContext, permission: Permission): void {
  const actor = ctx.actor;
  if (actor.type === 'system') return;
  if (actor.type === 'api_key') {
    if (!actor.scopes.includes(permission)) {
      throw new ApiError('insufficient_scope', {
        params: {
          permission,
          requiredPermission: permission,
          grantedScopes: [...actor.scopes],
        },
      });
    }
    return;
  }
  if (!roleHasPermission(actor.role, permission)) {
    throw new ApiError('forbidden', {
      params: {
        permission,
        requiredPermission: permission,
        currentRole: actor.role,
        grantedByRoles: rolesGranting(permission),
        // Doplní enrichForbidden, když má aktér právo členy vidět.
        contactableMembers: [],
      },
    });
  }
}
