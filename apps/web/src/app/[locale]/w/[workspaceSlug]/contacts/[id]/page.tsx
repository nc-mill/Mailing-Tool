import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ContactDetail, type ContactDetailData } from '@/features/contacts/contact-detail';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

type ContactApiDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  greeting: string;
  vocative_locked: boolean;
  gender: 'female' | 'male' | 'unknown';
  status: ContactDetailData['status'];
  processing_restricted: boolean;
  anonymized_at?: string | null;
  updated_at: string;
  lists: { list_id: string; name: string; subscribed_at: string; snooze_until: string | null }[];
  tags: { id: string; name: string }[];
  attributes: Record<string, unknown>;
  source: string;
  consents: { purpose: string; status: string; since: string }[];
};

type ContactFieldApi = { key: string; label: Record<string, string> };

/**
 * Titulek se nedělá druhým dotazem na kontakt. Byl by to stejný požadavek navíc a
 * e-mail v titulku prohlížeče je navíc osobní údaj viditelný v historii i na projektoru.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('list.title') };
}

export default async function ContactDetailPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  // Katalog vlastních polí se čte souběžně s kontaktem: bez něj by se atributy
  // vypsaly jako holé klíče (city místo Město).
  const [contact, fields] = await Promise.all([
    apiFetch<{ data: ContactApiDetail } | ContactApiDetail>(`/api/v1/contacts/${id}`, {
      workspaceId,
    }),
    apiFetch<{ data: ContactFieldApi[] }>('/api/v1/contact-fields', { workspaceId }),
  ]);

  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }

  // Obálka odpovědi se u detailu liší podle endpointu, proto obě větve.
  const payload = 'data' in contact.data ? (contact.data.data as ContactApiDetail) : contact.data;

  const labels = new Map(
    (fields.ok ? fields.data.data : []).map((field) => [
      field.key,
      field.label[locale] ?? field.label['cs'] ?? field.key,
    ]),
  );
  const snooze = payload.lists
    .map((list) => list.snooze_until)
    .filter((value): value is string => value !== null);

  const data: ContactDetailData = {
    id: payload.id,
    email: payload.email,
    name: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null,
    greeting: payload.greeting,
    greeting_locked: payload.vocative_locked,
    gender: payload.gender,
    status: payload.status,
    processing_restricted: payload.processing_restricted,
    snooze_until: snooze.length > 0 ? snooze.toSorted().at(-1)! : null,
    anonymized_at: payload.anonymized_at ?? null,
    status_changed_at: payload.updated_at,
    restriction_requested_at: null,
    lists: payload.lists.map((list) => ({ id: list.list_id, name: list.name })),
    tags: payload.tags,
    attributes: Object.entries(payload.attributes).map(([key, value]) => ({
      key,
      label: labels.get(key) ?? key,
      value: String(value ?? ''),
    })),
    source: payload.source,
    subscribed_at: payload.lists[0]?.subscribed_at ?? null,
    consent_summary: payload.consents[0]?.purpose ?? null,
  };

  return (
    <ContactDetail
      basePath={`/w/${workspaceSlug}/contacts`}
      workspacePath={`/w/${workspaceSlug}`}
      contact={data}
    />
  );
}
