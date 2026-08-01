import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { readCursor } from '@/lib/api-client/cursor';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { SuppressionsTable } from '@/features/contacts/suppressions-table';
import type { SuppressionRow, WorkspaceRole } from '@/features/contacts/suppression-affordance';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('suppressions.title') };
}

export default async function SuppressionsPage({ params, searchParams }: PageProps) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const reason = typeof query['reason'] === 'string' ? query['reason'] : undefined;
  const q = typeof query['q'] === 'string' ? query['q'] : undefined;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }

  const page = await apiFetch<{
    data: SuppressionRow[];
    pagination: {
      next_cursor: string | null;
      prev_cursor: string | null;
      has_more: boolean;
      limit: number;
    };
  }>('/api/v1/suppressions', {
    workspaceId: access.data.workspace.id,
    searchParams: {
      limit: 50,
      cursor: readCursor(query),
      ...(reason ? { reason } : {}),
      ...(q ? { q } : {}),
    },
  });

  if (!page.ok) return <ContactsProblem problem={page.problem} />;

  return (
    <SuppressionsTable
      basePath={`/w/${workspaceSlug}/suppressions`}
      rows={page.data.data}
      // Rozhraní roli používá jen k tomu, aby nenabízelo akci, která by na serveru
      // skončila 403. Skutečné rozhodnutí dělá assertPermission v API.
      role={access.data.role as WorkspaceRole}
      pagination={page.data.pagination}
      filters={{ ...(reason ? { reason } : {}), ...(q ? { q } : {}) }}
    />
  );
}
