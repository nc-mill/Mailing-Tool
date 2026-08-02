import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ListsTable, type ListRow } from '@/features/contacts/lists-table';

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
  const t = await getTranslations('contacts');
  return { title: t('lists.title') };
}

type ListApiRow = {
  id: string;
  name: string;
  opt_in: 'single' | 'double';
  archived_at: string | null;
};

type ListStats = { pending: number; confirmed: number };

export default async function ListsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const response = await apiFetch<{ data: ListApiRow[] }>('/api/v1/lists', { workspaceId });
  if (!response.ok) return <ContactsProblem problem={response.problem} />;

  // Počty nejsou součástí seznamu, vydává je GET /api/v1/lists/{id}/stats. Načítají se
  // souběžně, ne v cyklu za sebou: seznamů je jednotky, ne tisíce, a sekvenčně by se
  // čekání sčítalo. Kdyby jich přibylo, patří počet do seznamu, ne víc požadavků sem.
  const stats = await Promise.all(
    response.data.data.map((list) =>
      apiFetch<ListStats>(`/api/v1/lists/${list.id}/stats`, { workspaceId }),
    ),
  );

  const lists: ListRow[] = response.data.data.map((list, index) => {
    const row = stats[index];
    return {
      id: list.id,
      name: list.name,
      confirmed_count: row?.ok ? row.data.confirmed : 0,
      pending_count: row?.ok ? row.data.pending : 0,
      double_opt_in: list.opt_in === 'double',
      archived: list.archived_at !== null,
    };
  });

  return <ListsTable basePath={`/w/${workspaceSlug}/lists`} lists={lists} />;
}
