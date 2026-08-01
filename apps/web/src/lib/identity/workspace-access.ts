import 'server-only';
import { cache } from 'react';
import { apiFetch } from '@/lib/api-client/fetch';
import { localProblem, type Problem } from '@/lib/api-client/problem';
import { err, ok, type Result } from '@/lib/api-client/result';
import { getCurrentUser } from './current-user';
import { can, permissionsOf, type Permission, type Role } from './permissions';

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  address_form: 'formal' | 'informal';
  created_at: string;
};

export type WorkspaceAccess = {
  workspace: Workspace;
  role: Role;
  permissions: readonly Permission[];
  /** Jméno a e-mail uživatele, ke kterému se odkáže stav S11. */
  userName: string;
};

function notFound(instance: string): Problem {
  return {
    type: 'https://docs.mlain.dev/errors/not_found',
    title: 'Not found',
    status: 404,
    detail: '',
    instance,
    code: 'not_found',
    request_id: '',
  };
}

/**
 * Přeloží slug z URL na workspace a roli aktéra. Nečlen dostane 404, ne 403,
 * podle 3.4 části 1: kdyby dostal 403, dalo by se z toho zjistit, které
 * projekty existují.
 *
 * Členství se hledá podle pole `slug`, ne `workspace_slug`: viz komentář
 * u typu `Membership` a kapitola 2.1 plánu.
 */
export const getWorkspaceAccess = cache(async (slug: string): Promise<Result<WorkspaceAccess>> => {
  const me = await getCurrentUser();
  if (!me.ok) return err(me.problem);

  const membership = me.data.memberships.find((entry) => entry.slug === slug);
  if (!membership) return err(notFound(`/w/${slug}`));

  /**
   * OPRAVA PROTI DŘÍVĚJŠÍMU ZNĚNÍ: `GET /api/v1/workspaces/{id}` vrací projekt
   * **zabalený** do `{ workspace: … }`, ne holý objekt. Ověřeno ve schématu
   * odpovědi v OpenAPI běžící instance a pohledem do prohlížeče: bez rozbalení
   * měla všechna pole hodnotu `undefined`, takže nastavení projektu ukazovalo
   * prázdný název, prázdnou adresu a nevybrané jazyky, a nic přitom nespadlo.
   */
  const workspace = await apiFetch<{ workspace: Workspace }>(
    `/api/v1/workspaces/${membership.workspace_id}`,
    { workspaceId: membership.workspace_id },
  );
  if (!workspace.ok) return err(workspace.problem);

  return ok({
    workspace: workspace.data.workspace,
    role: membership.role,
    permissions: permissionsOf(membership.role),
    userName: me.data.user.name === '' ? me.data.user.email : me.data.user.name,
  });
});

export function hasPermission(access: WorkspaceAccess, permission: Permission): boolean {
  return can(access.role, permission);
}

export { localProblem };
