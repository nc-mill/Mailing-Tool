import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { defaultModelFor, listProviders } from '@mlain/core/ai';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { CredentialForm } from '@/features/ai/credential-form';
import { CredentialsSection } from '@/features/ai/credentials-section';
import { UsageChart } from '@/features/ai/usage-chart';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import {
  SettingsPageShell,
  SettingsSection,
  SettingsStack,
} from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { aiWorkspaceContext, fetchCredentials, fetchUsage } from '@/lib/ai/queries';
import { requireUser } from '@/lib/identity/require-user';
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
  const t = await getTranslations('ai');
  return { title: t('credentials.title') };
}

const USAGE_DAYS = 30;

export default async function AiSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('ai');

  const me = await requireUser(`/w/${workspaceSlug}/settings/ai`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'ai:configure')) {
    return (
      <ForbiddenSection
        permission="ai:configure"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  /*
   * Serverová komponenta čte přímo z databáze, ne přes vlastní REST: endpoint
   * by znamenal další kolo po síti pro data, která má proces k dispozici.
   * Zápis jde naopak vždy přes API, protože ho používá i asistent.
   */
  const ctx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  const [credentials, usage] = await Promise.all([
    fetchCredentials(ctx),
    fetchUsage(ctx, USAGE_DAYS),
  ]);

  const providers = listProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    allowsBaseUrl: provider.allowsBaseUrl,
    requiresBaseUrl: provider.requiresBaseUrl,
    defaultModel: defaultModelFor(provider.id) ?? '',
    signupUrl: provider.signupUrl,
  }));

  return (
    <SettingsPageShell title={t('credentials.title')} lead={t('byok.explain')}>
      <SettingsStack>
        <SettingsSection>
          <section aria-labelledby="ai-credentials">
            <h2 id="ai-credentials" className="sr-only">
              {t('credentials.title')}
            </h2>
            <CredentialsSection
              credentials={credentials}
              providers={providers.map((provider) => ({
                id: provider.id,
                label: provider.label,
                signupUrl: provider.signupUrl,
              }))}
              workspaceId={access.data.workspace.id}
              slug={workspaceSlug}
            />
          </section>
        </SettingsSection>

        <SettingsSection>
          <CredentialForm
            workspaceId={access.data.workspace.id}
            slug={workspaceSlug}
            providers={providers}
          />
        </SettingsSection>

        {/* Spotřeba je karta jako každá jiná sekce nastavení: nadpis 19 px
            přes `CardTitle`, ne `text-xl` z výchozí škály Tailwindu, a řádek
            vysvětlení pod ním v tlumeném drobném písmu. */}
        <Card aria-labelledby="ai-usage" gap="gutter">
          <div className="flex flex-col gap-[var(--spacing-hairline)]">
            <CardTitle>
              <span id="ai-usage">{t('usage.title')}</span>
            </CardTitle>
            <p className="max-w-[var(--size-text-column)] text-meta text-text-muted">
              {t('usage.lead')}
            </p>
          </div>
          <UsageChart report={usage} />
        </Card>
      </SettingsStack>
    </SettingsPageShell>
  );
}
