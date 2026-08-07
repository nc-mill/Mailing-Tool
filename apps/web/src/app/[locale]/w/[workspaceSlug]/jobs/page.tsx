import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { JobsList } from '@/features/jobs/jobs-list';
import { JobsProblem } from '@/features/jobs/jobs-problem';
import { JOBS_PAGE_LIMIT } from '@/features/jobs/refresh';
import type { JobsResponse } from '@/features/jobs/job-view';
import type { WorkerStatusResponse } from '@/features/jobs/worker-status-view';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';

/**
 * CENTRUM ÚLOH, seznam. Jediné místo, kde uživatel najde všechnu práci, která
 * běží nebo běžela na pozadí. Do 7. 8. 2026 komponenty existovaly v návrhovém
 * systému a API vracelo skutečná data, jen je v `apps/web` nikdo nepoužil:
 * nula výskytů `JobsCenter` i `JobsBadge` a adresář `jobs` v routách nebyl.
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('jobs.title') };
}

export default async function JobsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <JobsProblem problem={access.problem} />;
  }

  /**
   * Oprávnění se NEKONTROLUJE tady, ale v API (`timeline:read`), a to je
   * nejnižší oprávnění, které má i role pro čtení. Kdyby si obrazovka
   * rozhodovala sama, měla by o matici rolí vlastní názor, který se s API
   * dřív nebo později rozejde. Zamítnutí přijde jako Problem a vykreslí se.
   */
  /*
   * DVĚ VOLÁNÍ, NE JEDNO, a je to týž důvod, proč jsou to dvě cesty v API:
   * seznam se obnovuje jen dokud něco běží, stav workeru pořád. Sloučené
   * do jedné odpovědi by se musely obnovovat stejně a jedno z toho by bylo
   * špatně (zdůvodnění v `features/jobs/refresh.ts`).
   *
   * Běží NARÁZ. Sériově by se jejich doby sčítaly, a to je jedna z těch
   * skoro neviditelných cen, kvůli kterých se stránka otevírá pomaleji,
   * aniž by se dalo ukázat na jedno místo.
   */
  const [jobs, worker] = await Promise.all([
    apiFetch<JobsResponse>('/api/v1/jobs', {
      workspaceId: access.data.workspace.id,
      searchParams: { limit: JOBS_PAGE_LIMIT },
    }),
    apiFetch<WorkerStatusResponse>('/api/v1/jobs/worker', {
      workspaceId: access.data.workspace.id,
    }),
  ]);
  if (!jobs.ok) return <JobsProblem problem={jobs.problem} />;

  return (
    <JobsList
      initialJobs={jobs.data.data}
      initialNextBefore={jobs.data.next_before ?? null}
      initialTotal={jobs.data.total ?? jobs.data.data.length}
      /*
       * Nepodařený stav workeru stránku NESHODÍ. Panel je diagnostika navíc,
       * kdežto seznam je to, kvůli čemu sem člověk přišel; kdyby ho shodila
       * chyba panelu, přišel by o obojí.
       */
      initialWorker={worker.ok ? worker.data.worker : null}
      workspaceId={access.data.workspace.id}
      workspaceSlug={workspaceSlug}
    />
  );
}
