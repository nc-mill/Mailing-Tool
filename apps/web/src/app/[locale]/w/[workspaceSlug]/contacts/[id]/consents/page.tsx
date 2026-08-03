import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ConsentHistory, type ConsentRecord } from '@/features/contacts/consent-history';

/** Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ workspaceSlug: string; id: string }> };

type ContactApiDetail = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('consents.title') };
}

/**
 * Historie souhlasů kontaktu. Do téhle chvíle na ni detail odkazoval, ale stránka
 * neexistovala a odkaz končil na 404 (nález I92).
 *
 * Kontakt se čte kvůli JMÉNU v záhlaví, ne kvůli údajům: obrazovka bez něj by
 * ukazovala doklady „něčích" souhlasů. Čte se souběžně s historií, protože jedno
 * na druhém nezávisí.
 */
export default async function ConsentHistoryPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [contact, consents] = await Promise.all([
    apiFetch<{ data: ContactApiDetail } | ContactApiDetail>(`/api/v1/contacts/${id}`, {
      workspaceId,
    }),
    apiFetch<{ data: ConsentRecord[] }>(`/api/v1/contacts/${id}/consents`, { workspaceId }),
  ]);

  if (!contact.ok) {
    if (contact.problem.status === 404) notFound();
    return <ContactsProblem problem={contact.problem} />;
  }
  // Obálka odpovědi se u detailu liší podle endpointu, proto obě větve. Stejné
  // rozhodnutí je v `contacts/[id]/page.tsx`.
  const payload = 'data' in contact.data ? (contact.data.data as ContactApiDetail) : contact.data;

  // Historie se nenačetla, ale kontakt ano. Prázdný seznam by tady byl LEŽ:
  // „tenhle člověk nikdy nic nepodepsal" je jiné tvrzení než „nepodařilo se to
  // načíst", a na dokladové obrazovce je ten rozdíl to jediné, na čem záleží.
  if (!consents.ok) return <ContactsProblem problem={consents.problem} />;

  return (
    <ConsentHistory
      basePath={`/w/${workspaceSlug}/contacts`}
      contact={{
        id: payload.id,
        name: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || payload.email,
      }}
      records={consents.data.data}
    />
  );
}
