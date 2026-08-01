import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiKeysTable, type ApiKeyRow } from '@/features/api-keys/api-keys-table';
import { CreateKeyPanel } from '@/features/api-keys/create-key-panel';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('apiKeys.title') };
}

export default async function ApiKeysPage({
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

  if (!hasPermission(access.data, 'api_keys:read')) {
    return (
      <ForbiddenSection
        permission="api_keys:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const canWrite = hasPermission(access.data, 'api_keys:write');
  const keys = await apiFetch<{ data: ApiKeyRow[] }>('/api/v1/api-keys', {
    workspaceId: access.data.workspace.id,
  });

  return (
    <SettingsPageShell title={t('apiKeys.title')} lead={t('apiKeys.lead')}>
      <div className="space-y-12">
        <ApiKeysTable
          keys={keys}
          canWrite={canWrite}
          workspaceId={access.data.workspace.id}
          slug={workspaceSlug}
        />
        {canWrite ? (
          <CreateKeyPanel
            workspaceId={access.data.workspace.id}
            slug={workspaceSlug}
            availableScopes={access.data.permissions}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
