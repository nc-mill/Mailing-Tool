import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ChangeEmailForm } from '@/features/contacts/change-email-form';

/** Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ workspaceSlug: string; id: string }> };

type ContactApiDetail = {
  id: string;
  email: string;
  status: string;
  anonymized_at?: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('form.changeEmailTitle') };
}

export default async function ChangeEmailPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const contact = await apiFetch<{ data: ContactApiDetail }>(`/api/v1/contacts/${id}`, {
    workspaceId,
  });
  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }

  const payload = contact.data.data;
  if (payload.status === 'deleted' || (payload.anonymized_at ?? null) !== null) notFound();

  return (
    <ChangeEmailForm
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      basePath={`/w/${workspaceSlug}/contacts`}
      contact={{ id: payload.id, email: payload.email }}
    />
  );
}
