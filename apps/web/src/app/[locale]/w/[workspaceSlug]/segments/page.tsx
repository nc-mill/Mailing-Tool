import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SegmentList, type SegmentListRow } from '@/features/segments/segment-list';

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
  const t = await getTranslations('segments');
  return { title: t('title') };
}

type ApiSegment = {
  id: string;
  name: string;
  kind: 'dynamic' | 'static';
  preset_key: string | null;
  cached_count: number | null;
  cached_at: string | null;
};

type ApiPreset = { key: string; label_key: string; explanation_key: string };

export default async function SegmentsPage({ params }: PageProps) {
  const { locale, workspaceSlug } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [segments, presets] = await Promise.all([
    apiFetch<{ data: ApiSegment[] }>('/api/v1/segments', { workspaceId }),
    apiFetch<{ items: ApiPreset[] }>('/api/v1/segments/presets', { workspaceId }),
  ]);

  const rows: SegmentListRow[] = (segments.ok ? segments.data.data : []).map((segment) => ({
    id: segment.id,
    name: segment.name,
    kind: segment.kind,
    cachedCount: segment.cached_count,
    cachedAt: segment.cached_at,
  }));

  return (
    <SegmentList
      rows={rows}
      workspaceSlug={workspaceSlug}
      locale={locale}
      presets={(presets.ok ? presets.data.items : []).map((preset) => ({
        key: preset.key,
        labelKey: preset.label_key,
        explanationKey: preset.explanation_key,
        cachedCount: null,
        cachedAt: null,
      }))}
    />
  );
}
