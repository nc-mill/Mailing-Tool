import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { buildFieldCatalog } from '@/features/segments/field-catalog';
import { SegmentEditor } from '@/features/segments/segment-editor';

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
  const t = await getTranslations('segments');
  return { title: t('title') };
}

type ApiSegment = { id: string; name: string; definition: unknown };

/**
 * Katalog polí. Skládá se TADY, v serverové komponentě: matice operátorů
 * bydlí v `@mlain/core/segments`, který s sebou nese i přístup k databázi
 * a v prohlížeči by shodil celou stránku.
 */
async function fieldCatalog(workspaceId: string, selfId: string | null) {
  const [lists, segments] = await Promise.all([
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/segments', { workspaceId }),
  ]);
  const t = await getTranslations('segments');
  return buildFieldCatalog((key, values) => t(key, values), {
    lists: lists.ok ? lists.data.data.map((list) => ({ id: list.id, name: list.name })) : [],
    segments: (segments.ok ? segments.data.data : [])
      .filter((segment) => segment.id !== selfId)
      .map((segment) => ({ id: segment.id, name: segment.name })),
  });
}

export default async function SegmentDetailPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  // `new` je pseudoidentita pro založení segmentu, ne uuid. Bez téhle větve
  // by odkaz „Postavit vlastní" skončil na 404 dřív, než uživatel něco napíše.
  if (id === 'new') {
    const fields = await fieldCatalog(workspaceId, null);
    return (
      <SegmentEditor
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        locale={locale}
        segment={null}
        fields={fields}
      />
    );
  }

  const found = await apiFetch<ApiSegment>(`/api/v1/segments/${id}`, { workspaceId });
  if (!found.ok) notFound();

  const fields = await fieldCatalog(workspaceId, id);

  return (
    <SegmentEditor
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      locale={locale}
      segment={{ id: found.data.id, name: found.data.name, definition: found.data.definition }}
      fields={fields}
    />
  );
}
