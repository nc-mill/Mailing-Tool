import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { updateWorkspaceAction } from '@/features/workspace-settings/actions';
import { GeneralForm } from '@/features/workspace-settings/general-form';
import { AddressFormSection } from '@/features/workspace-settings/address-form-section';
import { DangerZone } from '@/features/workspace-settings/danger-zone';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { supportedTimezones } from '@/features/settings/timezones';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { ROLE_LABEL_KEYS } from '@/features/members/role-label';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('general.title') };
}

export default async function GeneralSettingsPage({
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

  const canWrite = hasPermission(access.data, 'workspace:update');
  const canDelete = hasPermission(access.data, 'workspace:delete');

  // Počet kontaktů je jen podklad pro text dialogu o oslovení. Když selže,
  // sekce funguje dál a dialog místo počtu neuvede nic (stav S8).
  const contactCount = await apiFetch<{ count: number }>('/api/v1/contacts/count', {
    workspaceId: access.data.workspace.id,
  });

  return (
    <SettingsPageShell
      title={t('general.title')}
      lead={t('general.lead', { projectName: access.data.workspace.name })}
      readOnly={
        canWrite
          ? undefined
          : {
              reason: t('states.readOnlyBody', {
                currentRole: t(ROLE_LABEL_KEYS[access.data.role]),
                permission: 'workspace:update',
              }),
            }
      }
    >
      <div className="space-y-12">
        <GeneralForm
          action={updateWorkspaceAction}
          workspace={access.data.workspace}
          locales={SUPPORTED_LOCALES}
          timezones={supportedTimezones()}
          canWrite={canWrite}
        />
        <AddressFormSection
          workspace={access.data.workspace}
          canWrite={canWrite}
          contactCount={contactCount.ok ? contactCount.data.count : 0}
        />
        {canDelete ? <DangerZone workspace={access.data.workspace} /> : null}
      </div>
    </SettingsPageShell>
  );
}
