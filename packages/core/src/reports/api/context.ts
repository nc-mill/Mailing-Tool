import type { Context } from 'hono';
import { withWorkspace, type Tx, type WorkspaceContext } from '../../tx';
import type { ApiVariables } from '../../identity/api/schemas';

/**
 * Jediné místo, kde tahle doména sahá na proměnné kontextu Hono a na
 * transakci. Kdyby se cokoliv z toho v P04 přejmenovalo, opravuje se to
 * tady a nikde jinde (rozhodnutí R4 o adaptérech platí i pro server).
 *
 * `auth` nastavuje autentizační middleware z P04 (`c.set('auth', { ctx, label })`).
 * Doména z něj bere jen `ctx`; `label` je pro audit, který tenhle plán nepíše.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM: plán zaváděl vlastní
 * `ReportsEnv = { Variables: { auth, reportsTx } }`. Kostra aplikace z P04 ale
 * plní i `requestId`, `clientIp`, `startedAt` a `runIdempotent`, takže vlastní
 * užší typ by mount do `OpenAPIHono<ApiEnv>` neprošel typovou kontrolou.
 * `ReportsEnv` proto rozšiřuje `ApiVariables` a přidává jedinou položku navíc.
 */
export type ReportsVariables = ApiVariables & {
  /** Nastavují jen testy. V provozu se transakce otevírá přes withWorkspace. */
  reportsTx?: Tx;
};

export type ReportsEnv = { Variables: ReportsVariables };

export function workspaceOf(c: Context<ReportsEnv>): WorkspaceContext {
  const auth = c.get('auth') as { ctx?: WorkspaceContext } | undefined;
  if (!auth?.ctx) throw new Error('Chybí kontext projektu. Cesta musí být za autentizací.');
  return auth.ctx;
}

/**
 * Stabilní klíč aktéra pro stropy spojení. Vlastní proměnnou pro relaci
 * middleware z P04 nenastavuje, takže by `c.get('sessionKey')` bylo
 * `undefined` a všichni uživatelé projektu by sdíleli jeden kbelík: druhý
 * otevřený tab kohokoliv by shodil kolegovi živý report na dotazování.
 */
export function actorKey(actor: WorkspaceContext['actor']): string {
  if (actor.type === 'user') return `user:${actor.userId}`;
  if (actor.type === 'api_key') return `api_key:${actor.apiKeyId}`;
  return `system:${actor.job}`;
}

/**
 * Otevře transakci v kontextu projektu.
 *
 * Bere **celý `WorkspaceContext`**, ne `workspaceId`. Obálky P03 to vyžadují
 * a je to schválně: obálka podle aktéra nastaví `mlain.workspace_id` vždy
 * a `mlain.user_id` u aktéra typu `user`, takže tady se `set_config` nevolá
 * ručně. Pool doplňuje adaptér `@mlain/core/tx` z P04, protože `packages/db`
 * žádný singleton nedrží a držet ho nemá.
 */
export async function inWorkspace<T>(
  c: Context<ReportsEnv>,
  fn: (tx: Tx, ctx: WorkspaceContext) => Promise<T>,
): Promise<T> {
  const ctx = workspaceOf(c);
  const injected = c.get('reportsTx');
  if (injected) return fn(injected, ctx);
  return withWorkspace(ctx, (tx) => fn(tx, ctx));
}
