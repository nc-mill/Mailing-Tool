import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  changeMemberRoleFormAction,
  removeMemberFormAction,
} from '@/features/members/actions-forms';
import { MembersTable, type MemberRow } from '@/features/members/members-table';
import { InvitationsSection, type InvitationRow } from '@/features/members/invitations-section';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
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
  const workspaceId = access.data.workspace.id;

  const [me, members, invitations] = await Promise.all([
    getCurrentUser(),
    apiFetch<{ data: MemberRow[] }>('/api/v1/members', { workspaceId }),
    canInvite
      ? apiFetch<{ data: InvitationRow[] }>('/api/v1/invitations', { workspaceId })
      : Promise.resolve({ ok: true as const, data: { data: [] as InvitationRow[] } }),
  ]);

  return (
    <SettingsPageShell title={t('members.title')} lead={t('members.lead')}>
      <div className="space-y-12">
        <MembersTable
          members={members}
          canManage={canManage}
          currentUserId={me.ok ? me.data.user.id : ''}
          changeRoleAction={changeMemberRoleFormAction}
          removeAction={removeMemberFormAction}
          workspaceId={workspaceId}
          slug={workspaceSlug}
        />
        {canInvite ? (
          <InvitationsSection
            invitations={invitations}
            workspaceId={workspaceId}
            slug={workspaceSlug}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
