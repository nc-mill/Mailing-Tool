import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SystemMailScreen } from '@/features/system-mail/system-mail-screen';
import type { SystemMailStatus } from '@/features/system-mail/types';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/** Stejný důvod jako u ostatních obrazovek nastavení: obsah závisí na relaci. */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('systemMail.title') };
}

export default async function SystemMailPage({
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

  if (!hasPermission(access.data, 'providers:read')) {
    return (
      <ForbiddenSection
        permission="providers:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const workspaceId = access.data.workspace.id;
  const status = await apiFetch<{ system_mail: SystemMailStatus }>('/api/v1/system-mail/status', {
    workspaceId,
  });

  return (
    <SettingsPageShell title={t('systemMail.title')} lead={t('systemMail.lead')}>
      {status.ok ? (
        <SystemMailScreen
          status={status.data.system_mail}
          workspaceId={workspaceId}
          slug={workspaceSlug}
          canConfigure={hasPermission(access.data, 'providers:write')}
        />
      ) : (
        <SettingsProblem problem={status.problem} />
      )}
    </SettingsPageShell>
  );
}
