import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ProgressView } from '@/features/campaigns/progress-view';
import type { CampaignProgress } from '@/features/campaigns/progress-screen';

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

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.progress');
  return { title: t('title') };
}

export default async function ProgressPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  const progress = await apiFetch<CampaignProgress>(`/api/v1/campaigns/${id}/progress`, {
    workspaceId: access.data.workspace.id,
  });
  if (!progress.ok) notFound();

  return (
    <ProgressView
      progress={progress.data}
      workspaceId={access.data.workspace.id}
      basePath={`/w/${workspaceSlug}`}
    />
  );
}
