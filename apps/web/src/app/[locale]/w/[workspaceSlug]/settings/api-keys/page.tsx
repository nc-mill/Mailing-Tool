import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiKeysTable, type ApiKeyRow } from '@/features/api-keys/api-keys-table';
import { CreateKeyPanel } from '@/features/api-keys/create-key-panel';
import {
  SettingsPageShell,
  SettingsSection,
  SettingsStack,
} from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
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
      <SettingsStack>
        {/* Tabulka jde až k rámečku karty, jak to popisuje základ. Získá tím
            60 px, o které se sloupec s akcemi dřív nevešel a usekával se. */}
        <SettingsSection padding="none">
          <ApiKeysTable
            keys={keys}
            canWrite={canWrite}
            workspaceId={access.data.workspace.id}
            slug={workspaceSlug}
          />
        </SettingsSection>
        {canWrite ? (
          <SettingsSection>
            <CreateKeyPanel
              workspaceId={access.data.workspace.id}
              slug={workspaceSlug}
              availableScopes={access.data.permissions}
            />
          </SettingsSection>
        ) : null}
      </SettingsStack>
    </SettingsPageShell>
  );
}
