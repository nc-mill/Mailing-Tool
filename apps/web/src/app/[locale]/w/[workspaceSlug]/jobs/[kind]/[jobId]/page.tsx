import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JobDetail } from '@/features/jobs/job-detail';
import { JobsProblem } from '@/features/jobs/jobs-problem';
import type { ApiJob } from '@/features/jobs/job-view';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';

/**
 * DETAIL ÚLOHY, cíl odkazu „Otevřít" ze seznamu (dřívější nález N30 z P06).
 * Bez téhle obrazovky vedl každý řádek Centra úloh nikam.
 *
 * DRUH ÚLOHY JE V CESTĚ SCHVÁLNĚ, stejně jako v API. ID úloh pocházejí
 * z různých doménových tabulek (`imports`, `campaign_audience_progress`)
 * a nejsou napříč nimi zaručeně jedinečná; bez druhu by se detail musel ptát
 * všech zdrojů a při shodě ID by ukázal cizí úlohu.
 *
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

type PageProps = {
  params: Promise<{ workspaceSlug: string; kind: string; jobId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('jobs.detailEyebrow') };
}

export default async function JobDetailPage({ params }: PageProps) {
  const { workspaceSlug, kind, jobId } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <JobsProblem problem={access.problem} />;
  }

  const job = await apiFetch<{ job: ApiJob }>(
    `/api/v1/jobs/${encodeURIComponent(kind)}/${encodeURIComponent(jobId)}`,
    { workspaceId: access.data.workspace.id },
  );

  if (!job.ok) {
    /**
     * 404 z API znamená neznámý druh NEBO neznámé ID, a to schválně: z rozdílu
     * by šlo zjistit, které druhy úloh instalace zná. Obrazovka to nerozplétá
     * a ukáže stejnou stránku „nenalezeno" jako zbytek aplikace.
     */
    if (job.problem.status === 404) notFound();
    return <JobsProblem problem={job.problem} />;
  }

  return (
    <JobDetail
      job={job.data.job}
      workspaceSlug={workspaceSlug}
      workspaceId={access.data.workspace.id}
    />
  );
}
