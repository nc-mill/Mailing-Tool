import { ApiError } from '../errors/api-error';
import type { Actor, Role, WorkspaceContext } from './types';

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

/**
 * Oprávnění, která aktér SÁM drží.
 *
 * `null` znamená „bez omezení" a má ho jedině systémový aktér: joby na pozadí
 * a instalační cesta nejdou přes žádnou roli a `assertPermission` je taky pouští
 * bez ptaní. Uživatel drží to, co jeho role v TOMHLE projektu, klíč to, co má
 * ve svých scopech. Je to jediný převod „aktér -> množina práv" v produktu,
 * takže se dvě níž stojící závory nemusí ptát na typ aktéra znovu.
 */
export function actorPermissions(actor: Actor): readonly Permission[] | null {
  if (actor.type === 'system') return null;
  // `Actor.scopes` z @mlain/db je `string[]`: úplný registr vlastní tenhle
  // soubor a P03 ho záměrně nezná. Nefiltruje se to přetypováním, ale
  // `isPermission`, takže scope, který v katalogu není (třeba zbytek po
  // odstraněném oprávnění), nedrží aktér ani omylem.
  if (actor.type === 'api_key') return actor.scopes.filter(isPermission);
  return ROLE_PERMISSIONS[actor.role];
}

/**
 * Smí aktér UDĚLIT tuhle roli? (nález N2, vysoká závažnost)
 *
 * Bez téhle závory stačilo být adminem: `members:update_role` má, `RoleSchema`
 * roli `owner` připouští, takže se admin povýšil na vlastníka a původního
 * vlastníka pak odebral, protože ochrana posledního vlastníka napočítala dva.
 * Táž díra byla v pozvánce i v zakládání člena s heslem, kde se role zapisuje
 * úplně stejně.
 *
 * DVĚ PRAVIDLA, KAŽDÉ Z JINÉHO DŮVODU:
 *
 * 1. Roli `owner` neuděluje ŽÁDNÁ z těchhle cest, ani vlastníkovi. Invariant 1
 *    ze 3.3 říká, že projekt má právě jednoho vlastníka, a jediná operace, která
 *    ho umí udržet, je `transferOwnership`: běží v jedné transakci, zamyká
 *    členství, ověří, že vlastník je pořád jeden, žádá heslo a starého vlastníka
 *    v témže kroku sundá na admina. Prosté nastavení role by dalo projektu dva
 *    vlastníky a rozbilo by tím i ochranu toho posledního.
 * 2. Nikdo neuděluje roli, která umí víc než on sám. Porovnávají se MNOŽINY
 *    OPRÁVNĚNÍ, ne pořadí v `ROLE_ORDER`, protože jen množiny dávají smysl
 *    i pro aktéra typu klíč, který žádnou roli nemá. Pro uživatele vychází
 *    obojí stejně, `ROLE_PERMISSIONS` je řetězec nadmnožin.
 *
 * Běžnou práci admina to nechává být: pozvat editora, přepnout editora na
 * prohlížejícího i založit člena s rolí admin projde dál, protože všechna ta
 * oprávnění admin sám drží.
 */
export function assertMayGrantRole(ctx: WorkspaceContext, role: Role): void {
  const actor = ctx.actor;
  if (actor.type === 'system') return;

  if (role === 'owner') {
    throw new ApiError('forbidden', {
      params: {
        reason: 'owner_role_only_via_transfer',
        grantedRole: role,
        requiredPermission: 'workspace:transfer',
        currentRole: actor.type === 'user' ? actor.role : null,
      },
    });
  }

  const held = actorPermissions(actor);
  /* c8 ignore next -- systémový aktér se vrátil o pár řádků výš. */
  if (held === null) return;
  const missing = ROLE_PERMISSIONS[role].filter((p) => !held.includes(p));
  if (missing.length > 0) {
    throw new ApiError('forbidden', {
      params: {
        reason: 'role_above_actor',
        grantedRole: role,
        currentRole: actor.type === 'user' ? actor.role : null,
        missingPermissions: missing,
      },
    });
  }
}

/**
 * Smí aktér VYDAT klíč s těmihle scopy? (nález N3, vysoká závažnost)
 *
 * Katalog scopů a matice oprávnění jsou schválně JEDEN jmenný prostor (viz
 * hlavička souboru), takže se scope klíče dá porovnat s tím, co drží ten, kdo
 * klíč vydává. Do opravy se porovnával jen s katalogem: admin má `api_keys:write`,
 * ale `backups:run` je v `OWNER_EXTRA`, a přesto si klíč s ním vydal. Zálohy
 * běží pod migrátorem, na kterého row level security nedopadá, takže by dump
 * nesl celou instalaci, ne jen ten jeden projekt. Druhá varianta ruší smysl
 * omezování klíčů úplně: klíč se scope `api_keys:write` si vyrobil klíč se vším.
 *
 * Platí i pro ROTACI, ne jen pro vydání. Rotace vydává nový sekret ke starým
 * scopům, takže by admin jinak obnovil klíč s `backups:run`, který mu zbyl
 * po vlastníkovi, a měl by dál tutéž cestu ven.
 */
export function assertMayGrantScopes(ctx: WorkspaceContext, scopes: readonly Permission[]): void {
  const held = actorPermissions(ctx.actor);
  if (held === null) return;
  const missing = scopes.filter((s) => !held.includes(s));
  if (missing.length > 0) {
    throw new ApiError('forbidden', {
      params: {
        reason: 'scopes_above_actor',
        missingScopes: missing,
        currentRole: ctx.actor.type === 'user' ? ctx.actor.role : null,
      },
    });
  }
}
