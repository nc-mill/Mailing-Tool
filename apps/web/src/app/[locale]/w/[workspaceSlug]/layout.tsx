import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthProblem } from '@/features/auth/action-problem';
import { createWorkspaceAction } from '@/features/auth/actions';
import { WorkspaceShell } from '@/features/shell/workspace-shell';
import { permissionsOf } from '@/lib/identity/permissions';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';

/**
 * Serverová část skořápky projektu. Načte relaci a předá klientské skořápce
 * SKUTEČNÁ data: seznam projektů přihlášeného, oprávnění jeho role v tomhle
 * projektu, název projektu a jeho vlastní účet.
 *
 * PROČ TENHLE SOUBOR VZNIKL: do 4. 8. 2026 tady stála zástupná verze z plánu
 * designového systému, s poznámkou „Relace, oprávnění a seznam projektů dodá
 * vrstva identity". Vrstva identity mezitím dávno existovala, jen ji sem nikdo
 * nepřipojil, takže:
 *   - přepínač projektů dostával seznam o JEDNOM prvku, tom otevřeném, a
 *     přepnout se proto nedalo, i kdyby měl uživatel projektů deset,
 *   - v hlavičce svítil slug (`eshop-kolo`) místo názvu (`E-shop Kolo`),
 *   - oprávnění byla natvrdo napsaný seznam, ve kterém chybělo `providers:read`,
 *     `ai:configure`, `backups:read` i `templates:write`, takže se z menu
 *     odfiltrovalo pět hotových obrazovek Nastavení včetně Odesílání,
 *   - uživatelská nabídka byla `null`, tedy nešlo se odhlásit.
 *
 * Skořápka je rozdělená na dva soubory schválně. Data umí načíst jen serverová
 * komponenta (cookie relace, `server-only`), interaktivitu a providery umí jen
 * klientská. Testovat jde obojí zvlášť: tenhle soubor za to, CO předá, klientský
 * za to, jak to vykreslí.
 */
export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const me = await requireUser(`/w/${workspaceSlug}`);
  // Nepřihlášeného přesměruje `requireUser` sám. Sem se dojde jen u jiné
  // potíže, třeba když API neodpovídá, a to je potřeba říct: bez relace
  // nemá skořápka co vykreslit a prázdná hlavička vypadá jako rozbité menu.
  if (!me.ok) return <AuthProblem problem={me.problem} />;

  /**
   * Nečlen dostane 404, ne 403: z rozdílu by se dalo vyčíst, které projekty
   * na instalaci existují (3.4 části 1). Rozhoduje se podle členství, které
   * už relaci doprovází, takže se kvůli tomu nikam nesahá.
   */
  const membership = me.data.memberships.find((entry) => entry.slug === workspaceSlug);
  if (!membership) notFound();

  /**
   * `getWorkspaceAccess` je zdroj pravdy o názvu projektu a o oprávněních a
   * je cachovaný na požadavek, takže si ho obrazovky pod skořápkou (Nastavení)
   * berou zadarmo.
   *
   * Když ale selže, skořápka se NEVZDÁVÁ a poskládá se z členství: jméno,
   * slug i role v něm jsou. Výpadek jednoho čtení by jinak zhasl hlavičku,
   * menu i odhlášení na každé stránce projektu, přestože stránka pod nimi
   * svoje data mít může.
   */
  const access = await getWorkspaceAccess(workspaceSlug);
  const workspace = access.ok
    ? access.data.workspace
    : { id: membership.workspace_id, slug: membership.slug, name: membership.name };
  const permissions = access.ok ? access.data.permissions : permissionsOf(membership.role);

  const workspaces = me.data.memberships.map((entry) => ({
    id: entry.workspace_id,
    slug: entry.slug,
    name: entry.name,
  }));

  return (
    <WorkspaceShell
      workspaces={workspaces}
      currentWorkspaceId={workspace.id}
      permissions={permissions}
      user={{ name: me.data.user.name, email: me.data.user.email }}
      createWorkspace={createWorkspaceAction}
    >
      {children}
    </WorkspaceShell>
  );
}
