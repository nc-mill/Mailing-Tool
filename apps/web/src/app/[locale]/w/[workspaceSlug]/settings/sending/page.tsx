import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SendingScreen } from '@/features/sending/sending-screen';
import type { DomainView, ProviderView } from '@/features/sending/sending-settings';
import type { GuardLimits, GuardSettings } from '@/features/sending/guard-thresholds';
import type { TrialView } from '@/features/sending/trial-mode-panel';

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

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.sending');
  return { title: t('title') };
}

export default async function SendingSettingsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  /*
   * 404 JEN Z OPRAVDOVÉ 404, viz komentář u obrazovky předvoleb odesílatele.
   * Nečlen 404 dostane, vypršelý požadavek dostane chybový blok, ze kterého
   * jde jít znovu.
   */
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [providers, domains, guards, trial] = await Promise.all([
    apiFetch<{ data: ProviderView[] }>('/api/v1/providers', { workspaceId }),
    apiFetch<{ data: DomainView[] }>('/api/v1/domains', { workspaceId }),
    apiFetch<{ settings: GuardSettings; limits: GuardLimits }>('/api/v1/settings/deliverability', {
      workspaceId,
    }),
    apiFetch<TrialView>('/api/v1/settings/trial', { workspaceId }),
  ]);

  /*
   * Prahy doručitelnosti a zkušební režim jsou POVINNÉ: bez nich by obrazovka
   * ukázala nastavení, které neodpovídá skutečnosti. Číselníky nad nimi se
   * naopak degradují na prázdno, protože ty obrazovku jen doplňují.
   *
   * Ani povinné čtení ale není důvod tvrdit, že stránka neexistuje. 404 se
   * vydá jen tehdy, když ji vrátilo API; vypršení a výpadek dostanou blok
   * s kódem a číslem požadavku.
   */
  if (!guards.ok) {
    if (guards.problem.status === 404) notFound();
    return <SettingsProblem problem={guards.problem} />;
  }
  if (!trial.ok) {
    if (trial.problem.status === 404) notFound();
    return <SettingsProblem problem={trial.problem} />;
  }

  return (
    <SendingScreen
      providers={providers.ok ? providers.data.data : []}
      domains={domains.ok ? domains.data.data : []}
      guards={guards.data.settings}
      limits={guards.data.limits}
      trial={trial.data}
      basePath={`/w/${workspaceSlug}`}
      workspaceId={workspaceId}
    />
  );
}
