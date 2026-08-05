import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { EmbedPanel } from '@/features/forms/embed-panel';
import type { FormEmbedView, FormView } from '@/features/forms/types';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('embed.title') };
}

export default async function FormEmbedPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [embed, form] = await Promise.all([
    apiFetch<FormEmbedView>(`/api/v1/forms/${id}/embed`, { workspaceId }),
    apiFetch<{ data: FormView }>(`/api/v1/forms/${id}`, { workspaceId }),
  ]);

  if (!embed.ok) {
    if (embed.problem.status === 404) notFound();
    return <ContactsProblem problem={embed.problem} />;
  }

  return (
    <EmbedPanel
      formId={id}
      // Jméno formuláře je jen popisek nad kódem, takže selhání detailu obrazovku
      // neshodí: kód k vložení je tu i tak celý.
      formName={form.ok ? form.data.data.name : ''}
      embed={embed.data}
      basePath={`/w/${workspaceSlug}/forms`}
    />
  );
}
