import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactForm, type ContactFormField } from '@/features/contacts/contact-form';
import { saveContactAction } from '@/features/contacts/edit-actions';

/** Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

type ContactApiDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title_prefix: string | null;
  title_suffix: string | null;
  gender: 'female' | 'male' | 'unknown';
  greeting: string;
  vocative_locked: boolean;
  status: string;
  anonymized_at?: string | null;
  attributes: Record<string, unknown>;
  tags: { id: string; name: string }[];
  lists: { list_id: string; name: string; status: string }[];
};

type ContactFieldApi = {
  key: string;
  label: Record<string, string>;
  type: ContactFormField['type'];
  archived_at: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('form.editTitle') };
}

/**
 * Hodnota vlastního pole do textového vstupu. Pole s víc hodnotami se spojuje čárkami,
 * protože stejným oddělovačem se v akci zase rozděluje.
 */
function toInputValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (Array.isArray(raw)) return raw.map(String).join(', ');
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

export default async function EditContactPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [contact, fields, tags, lists] = await Promise.all([
    apiFetch<{ data: ContactApiDetail }>(`/api/v1/contacts/${id}`, { workspaceId }),
    apiFetch<{ data: ContactFieldApi[] }>('/api/v1/contact-fields', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags', {
      workspaceId,
      searchParams: { limit: 200 },
    }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
  ]);

  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }
  const payload = contact.data.data;

  // Smazaný nebo anonymizovaný kontakt se needituje. Detail ho ukazuje jen ke čtení
  // a formulář by na něm stejně skončil chybou ze serveru; 404 je poctivější než
  // obrazovka, která vypadá použitelně a použitelná není.
  if (payload.status === 'deleted' || (payload.anonymized_at ?? null) !== null) notFound();

  const workspaceTags = tags.ok ? tags.data.data.map((tag) => tag.name) : [];
  // Štítky kontaktu, které v katalogu projektu chybí, se přidávají k nabídce.
  // Bez toho by uložení formuláře kontakt o takový štítek tiše připravilo.
  const tagNames = [...new Set([...workspaceTags, ...payload.tags.map((tag) => tag.name)])];
  const selectedTags = new Set(payload.tags.map((tag) => tag.name));

  const subscribed = new Set(
    payload.lists.filter((list) => list.status !== 'unsubscribed').map((list) => list.list_id),
  );
  const listCatalog = lists.ok ? lists.data.data : [];

  return (
    <ContactForm
      mode="edit"
      action={saveContactAction}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      basePath={`/w/${workspaceSlug}/contacts`}
      values={{
        id: payload.id,
        email: payload.email,
        first_name: payload.first_name ?? '',
        last_name: payload.last_name ?? '',
        title_prefix: payload.title_prefix ?? '',
        title_suffix: payload.title_suffix ?? '',
        gender: payload.gender,
        greeting: payload.greeting,
        greeting_locked: payload.vocative_locked,
        fields: (fields.ok ? fields.data.data : [])
          .filter((field) => field.archived_at === null)
          .map((field) => ({
            key: field.key,
            label: field.label[locale] ?? field.label['cs'] ?? field.key,
            type: field.type,
            value: toInputValue(payload.attributes[field.key]),
          })),
        tags: tagNames.map((name) => ({ name, selected: selectedTags.has(name) })),
        lists: listCatalog.map((list) => ({
          id: list.id,
          name: list.name,
          selected: subscribed.has(list.id),
        })),
      }}
    />
  );
}
