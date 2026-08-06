import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  changeMemberRoleFormAction,
  removeMemberFormAction,
} from '@/features/members/actions-forms';
import { MembersTable, type MemberRow } from '@/features/members/members-table';
import { InvitationsSection, type InvitationRow } from '@/features/members/invitations-section';
import { CreateMemberSection } from '@/features/members/create-member-section';
import { OrphanedAccounts, type OrphanedAccountRow } from '@/features/members/orphaned-accounts';
import type { SystemMailStatus } from '@/features/system-mail/types';
import {
  SettingsPageShell,
  SettingsSection,
  SettingsStack,
} from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getCurrentUser } from '@/lib/identity/current-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('members.title') };
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'members:read')) {
    return (
      <ForbiddenSection
        permission="members:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const canManage = hasPermission(access.data, 'members:update_role');
  const canInvite = hasPermission(access.data, 'members:invite');
  // Účty bez projektu jsou správa instalace, ne projektu. Váže se na oprávnění
  // odebírat členy, protože smazání účtu je jeho pokračování: odebráním z projektu
  // účet nezaniká a bez tohohle výpisu by ho pak nikdo nenašel.
  const canDeleteAccounts = hasPermission(access.data, 'members:remove');
  const workspaceId = access.data.workspace.id;

  /**
   * Stav systémové pošty se načítá TADY, ne až po odeslání formuláře.
   *
   * Pozvánka odchází systémovým e-mailem a instalace s jediným odesílacím
   * účtem typu SES ho odeslat neumí. Bez tohohle dotazu obrazovka nabízela
   * pozvánku, kterou nikdo nikdy nedostal. Když se stav načíst nepodaří,
   * bere se jako nedostupný: nabídnout pozvánku, o které nevíme, je horší
   * než ji nenabídnout a ukázat cestu k nastavení.
   */
  const [me, members, invitations, systemMail, orphaned] = await Promise.all([
    getCurrentUser(),
    apiFetch<{ data: MemberRow[] }>('/api/v1/members', { workspaceId }),
    canInvite
      ? apiFetch<{ data: InvitationRow[] }>('/api/v1/invitations', { workspaceId })
      : Promise.resolve({ ok: true as const, data: { data: [] as InvitationRow[] } }),
    canInvite
      ? apiFetch<{ system_mail: SystemMailStatus }>('/api/v1/system-mail/status', { workspaceId })
      : Promise.resolve({ ok: false as const }),
    canDeleteAccounts
      ? apiFetch<{ data: OrphanedAccountRow[] }>('/api/v1/users/orphaned', { workspaceId })
      : Promise.resolve({ ok: true as const, data: { data: [] as OrphanedAccountRow[] } }),
  ]);
  const systemMailAvailable =
    systemMail.ok && 'data' in systemMail ? systemMail.data.system_mail.available : false;

  return (
    <SettingsPageShell title={t('members.title')} lead={t('members.lead')}>
      <SettingsStack>
        <SettingsSection>
          <MembersTable
            members={members}
            canManage={canManage}
            currentUserId={me.ok ? me.data.user.id : ''}
            changeRoleAction={changeMemberRoleFormAction}
            removeAction={removeMemberFormAction}
            workspaceId={workspaceId}
            slug={workspaceSlug}
          />
        </SettingsSection>
        {canInvite ? (
          <>
            <SettingsSection>
              <InvitationsSection
                invitations={invitations}
                workspaceId={workspaceId}
                slug={workspaceSlug}
                systemMailAvailable={systemMailAvailable}
              />
            </SettingsSection>
            {/* Náhradní cesta k pozvánce. Stojí pod ní schválně: kde pošta
                funguje, je pozvánka pořád první volbou, protože si člověk
                nastaví heslo sám a nikdo ho nepředává ústně. */}
            <SettingsSection>
              <CreateMemberSection workspaceId={workspaceId} slug={workspaceSlug} />
            </SettingsSection>
          </>
        ) : null}
        {canDeleteAccounts ? (
          <SettingsSection>
            <OrphanedAccounts accounts={orphaned} workspaceId={workspaceId} slug={workspaceSlug} />
          </SettingsSection>
        ) : null}
      </SettingsStack>
    </SettingsPageShell>
  );
}
