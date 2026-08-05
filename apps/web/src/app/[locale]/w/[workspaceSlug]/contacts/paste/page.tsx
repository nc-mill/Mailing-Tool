import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { PasteContacts } from '@/features/contacts/paste-contacts';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. Stejné
 * zdůvodnění jako u ostatních stránek projektu, viz `contacts/page.tsx`.
 *
 * Segment `paste` je statický, takže si ho Next vezme dřív než sousední `[id]`.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('paste.title') };
}

export default async function PasteContactsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  // Dva nezávislé požadavky najednou. Seznamy a štítky spolu nesouvisí a čekat
  // na ně po sobě by zdrželo obrazovku, na které jde hlavně o textové pole.
  const [lists, tags] = await Promise.all([
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags', {
      workspaceId,
      searchParams: { limit: 200 },
    }),
  ]);

  // Nedostupný číselník obrazovku NESHODÍ: vložit kontakty jde i bez zařazení
  // do seznamu a bez štítků, kdežto chybová stránka místo textového pole by
  // zablokovala tu jedinou věc, kvůli které sem uživatel jde.
  return (
    <PasteContacts
      workspaceId={workspaceId}
      basePath={`/w/${workspaceSlug}/contacts`}
      lists={lists.ok ? lists.data.data : []}
      tags={tags.ok ? tags.data.data : []}
    />
  );
}
