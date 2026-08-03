import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ListDetail, type ListDetailData } from '@/features/contacts/list-detail';

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
  const t = await getTranslations('contacts');
  return { title: t('lists.title') };
}

type ListApi = {
  id: string;
  name: string;
  opt_in: 'single' | 'double';
  confirmation_mode: 'one_step' | 'two_step';
  archived_at: string | null;
};

type ListStats = { pending: number; confirmed: number };

export default async function ListDetailPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [detail, stats] = await Promise.all([
    apiFetch<{ data: ListApi }>(`/api/v1/lists/${id}`, { workspaceId }),
    apiFetch<ListStats>(`/api/v1/lists/${id}/stats`, { workspaceId }),
  ]);

  if (!detail.ok) {
    if (detail.problem.status === 404) notFound();
    return <ContactsProblem problem={detail.problem} />;
  }

  const list: ListDetailData = {
    id: detail.data.data.id,
    name: detail.data.data.name,
    confirmed_count: stats.ok ? stats.data.confirmed : 0,
    pending_count: stats.ok ? stats.data.pending : 0,
    double_opt_in: detail.data.data.opt_in === 'double',
    confirmation_mode: detail.data.data.confirmation_mode,
    archived: detail.data.data.archived_at !== null,
  };

  return (
    <ListDetail basePath={`/w/${workspaceSlug}/lists`} workspaceId={workspaceId} list={list} />
  );
}
