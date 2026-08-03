import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactForm, type ContactFormField } from '@/features/contacts/contact-form';
import { createContactAction } from '@/features/contacts/edit-actions';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. Stejné
 * zdůvodnění jako u ostatních stránek projektu, viz `contacts/page.tsx`.
 *
 * Segment `new` je statický, takže si ho Next vezme dřív než sousední `[id]`.
 * Kontakt s identifikátorem „new" tím pádem nejde otevřít, což je v pořádku:
 * identifikátory jsou UUID.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

type ContactFieldApi = {
  key: string;
  label: Record<string, string>;
  type: ContactFormField['type'];
  archived_at: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('form.createTitle') };
}

export default async function NewContactPage({ params }: PageProps) {
  const { locale, workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [fields, tags, lists] = await Promise.all([
    apiFetch<{ data: ContactFieldApi[] }>('/api/v1/contact-fields', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags', {
      workspaceId,
      searchParams: { limit: 200 },
    }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
  ]);

  return (
    <ContactForm
      mode="create"
      action={createContactAction}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      basePath={`/w/${workspaceSlug}/contacts`}
      values={{
        id: null,
        email: '',
        first_name: '',
        last_name: '',
        title_prefix: '',
        title_suffix: '',
        gender: 'unknown',
        greeting: null,
        greeting_locked: false,
        fields: (fields.ok ? fields.data.data : [])
          // Archivované pole se nenabízí k vyplnění. Vyplnit ho jde přes API dál,
          // ale nabízet ho na obrazovce by znamenalo sbírat data, která projekt
          // vědomě přestal používat.
          .filter((field) => field.archived_at === null)
          .map((field) => ({
            key: field.key,
            label: field.label[locale] ?? field.label['cs'] ?? field.key,
            type: field.type,
            value: '',
          })),
        tags: (tags.ok ? tags.data.data : []).map((tag) => ({ name: tag.name, selected: false })),
        lists: (lists.ok ? lists.data.data : []).map((list) => ({
          id: list.id,
          name: list.name,
          selected: false,
        })),
      }}
    />
  );
}
