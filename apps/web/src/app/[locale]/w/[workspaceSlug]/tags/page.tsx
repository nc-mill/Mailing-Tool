import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { TagsTable, type TagRow } from '@/features/contacts/tags-table';

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
  return { title: t('tags.title') };
}

/** Štítky jsou pod Kontakty, ne pod Nastavením (rozhodnutí R11 hlavičky plánu). */
export default async function TagsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }

  const response = await apiFetch<{ data: TagRow[] }>('/api/v1/tags', {
    workspaceId: access.data.workspace.id,
    searchParams: { limit: 200 },
  });
  if (!response.ok) return <ContactsProblem problem={response.problem} />;

  return <TagsTable tags={response.data.data} />;
}
