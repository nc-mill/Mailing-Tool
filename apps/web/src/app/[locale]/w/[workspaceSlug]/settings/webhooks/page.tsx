import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { enableWebhookFormAction } from '@/features/webhooks/actions-forms';
import {
  WebhooksTable,
  WEBHOOK_ENDPOINT_LIMIT,
  type WebhookRow,
} from '@/features/webhooks/webhooks-table';
import { WebhookForm } from '@/features/webhooks/webhook-form';
import { MVP0_EVENT_TYPES } from '@/features/webhooks/event-types';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('webhooks.title') };
}

export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ emptied?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { emptied } = await searchParams;
  const t = await getTranslations('settings');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'webhooks:read')) {
    return (
      <ForbiddenSection
        permission="webhooks:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const canWrite = hasPermission(access.data, 'webhooks:write');
  const endpoints = await apiFetch<{ data: WebhookRow[] }>('/api/v1/webhook-endpoints', {
    workspaceId: access.data.workspace.id,
  });

  const atLimit = endpoints.ok && endpoints.data.data.length >= WEBHOOK_ENDPOINT_LIMIT;

  return (
    <SettingsPageShell title={t('webhooks.title')} lead={t('webhooks.lead')}>
      <div className="space-y-12">
        <WebhooksTable
          endpoints={endpoints}
          canWrite={canWrite}
          workspaceId={access.data.workspace.id}
          slug={workspaceSlug}
          emptied={emptied === '1'}
          enableAction={enableWebhookFormAction}
        />
        {canWrite && !atLimit ? (
          <WebhookForm
            mode="create"
            workspaceId={access.data.workspace.id}
            slug={workspaceSlug}
            availableEventTypes={MVP0_EVENT_TYPES}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
