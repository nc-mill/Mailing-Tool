import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { updateWorkspaceAction } from '@/features/workspace-settings/actions';
import { GeneralForm } from '@/features/workspace-settings/general-form';
import { AddressFormSection } from '@/features/workspace-settings/address-form-section';
import { GreetingEnabledSection } from '@/features/workspace-settings/greeting-enabled-section';
import { GreetingLocaleSection } from '@/features/workspace-settings/greeting-locale-section';
import { DangerZone } from '@/features/workspace-settings/danger-zone';
import {
  SettingsColumns,
  SettingsPageShell,
  SettingsStack,
} from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { supportedTimezones } from '@/features/settings/timezones';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { ROLE_LABEL_KEYS } from '@/features/members/role-label';

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

  // Obě sekce o oslovení řídí jeden vypínač. Když je vypnutý, nevykreslí se ani
  // ony, ani se NEDĚLAJÍ dotazy, které je napájejí: projekt, který oslovení
  // neřeší, nemá důvod počítat kontakty k přepočtu 5. pádu.
  const greetingEnabled = access.data.workspace.greeting_enabled;

  // Počet kontaktů je jen podklad pro text dialogu o oslovení. Když selže,
  // sekce funguje dál a dialog místo počtu neuvede nic (stav S8).
  const contactCount = greetingEnabled
    ? await apiFetch<{ count: number }>('/api/v1/contacts/count', {
        workspaceId: access.data.workspace.id,
      })
    : null;

  // Rozpad jazyků kontaktů. Když selže, sekce o jazyku oslovení se nevykreslí vůbec:
  // nabízet hromadný přepočet bez počtu dotčených kontaktů znamená klikat naslepo.
  const greetingLocale = greetingEnabled
    ? await apiFetch<{
        data: {
          workspace_locale: string;
          total: number;
          mismatched: number;
          by_locale: { locale: string; count: number }[];
        };
      }>('/api/v1/greeting-locale', { workspaceId: access.data.workspace.id })
    : null;

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
      {/* Dva sloupce jako detail seznamu: vlevo pole, vpravo volby a přepínače.
          Oslovení drží pohromadě v pravém sloupci, protože je to jeden celek:
          vypínač nahoře řídí obě sekce pod sebou. */}
      <SettingsStack>
        <SettingsColumns>
          <SettingsStack>
            <GeneralForm
              action={updateWorkspaceAction}
              workspace={access.data.workspace}
              locales={SUPPORTED_LOCALES}
              timezones={supportedTimezones()}
              canWrite={canWrite}
            />
          </SettingsStack>

          <SettingsStack>
            <GreetingEnabledSection workspace={access.data.workspace} canWrite={canWrite} />
            {greetingEnabled ? (
              <AddressFormSection
                workspace={access.data.workspace}
                canWrite={canWrite}
                contactCount={contactCount?.ok ? contactCount.data.count : 0}
              />
            ) : null}
            {greetingEnabled && greetingLocale?.ok ? (
              <GreetingLocaleSection
                workspaceId={access.data.workspace.id}
                canWrite={canWrite}
                summary={greetingLocale.data.data}
              />
            ) : null}
          </SettingsStack>
        </SettingsColumns>

        {/* Smazání projektu stojí pod oběma sloupci, přes celou šířku: netýká
            se ani jedné poloviny, týká se celého projektu. */}
        {canDelete ? <DangerZone workspace={access.data.workspace} /> : null}
      </SettingsStack>
    </SettingsPageShell>
  );
}
