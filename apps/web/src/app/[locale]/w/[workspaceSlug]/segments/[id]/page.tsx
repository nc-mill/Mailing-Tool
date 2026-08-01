import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SegmentEditor } from '@/features/segments/segment-editor';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('segments');
  return { title: t('title') };
}

type ApiSegment = { id: string; name: string; definition: unknown };

export default async function SegmentDetailPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  // `new` je pseudoidentita pro založení segmentu, ne uuid. Bez téhle větve
  // by odkaz „Postavit vlastní" skončil na 404 dřív, než uživatel něco napíše.
  if (id === 'new') {
    return (
      <SegmentEditor
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        locale={locale}
        segment={null}
      />
    );
  }

  const found = await apiFetch<ApiSegment>(`/api/v1/segments/${id}`, { workspaceId });
  if (!found.ok) notFound();

  return (
    <SegmentEditor
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      locale={locale}
      segment={{ id: found.data.id, name: found.data.name, definition: found.data.definition }}
    />
  );
}
