import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { VocativeReview } from '@/features/contacts/vocative-review';
import type { VocativeReviewGroupView } from '@/features/contacts/vocative-review-types';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('vocative.title') };
}

type GroupApi = Omit<VocativeReviewGroupView, 'display_name'> & { display_name?: string };

export default async function VocativeReviewPage({ params, searchParams }: PageProps) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const importId = typeof query['import_id'] === 'string' ? query['import_id'] : undefined;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [page, counts] = await Promise.all([
    apiFetch<{ data: GroupApi[] }>('/api/v1/vocative-review', {
      workspaceId,
      searchParams: { limit: 50, ...(importId ? { import_id: importId } : {}) },
    }),
    apiFetch<{ groups: number; contacts: number; total_contacts: number }>(
      '/api/v1/vocative-review/count',
      { workspaceId, searchParams: importId ? { import_id: importId } : {} },
    ),
  ]);

  // Endpointy fronty oslovení dodává úkol 55 a 56 téhož plánu (HTTP vrstva).
  // Dokud nestojí, obrazovka ukáže prázdnou frontu, ne rozbitou stránku: prázdná
  // fronta je pravdivé tvrzení „není co kontrolovat", ne výmysl o datech.
  const groups = page.ok ? page.data.data : [];

  return (
    <VocativeReview
      basePath={`/w/${workspaceSlug}/contacts`}
      workspaceId={workspaceId}
      groups={groups.map((group) => ({
        ...group,
        display_name: group.display_name ?? group.name_key,
      }))}
      totals={{
        groups: counts.ok ? counts.data.groups : groups.length,
        uncertainContacts: counts.ok ? counts.data.contacts : 0,
        totalContacts: counts.ok ? counts.data.total_contacts : 0,
      }}
    />
  );
}
