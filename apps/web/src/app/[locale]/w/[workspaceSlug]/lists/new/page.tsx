import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { ListCreateForm } from '@/features/contacts/list-create-form';

/**
 * Založení seznamu. Do 5. 8. 2026 tahle obrazovka neexistovala a tlačítko
 * „Nový seznam" ve výpisu nemělo žádnou akci, takže seznam nešlo z rozhraní
 * založit vůbec.
 *
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ, viz
 * `lists/page.tsx`. Segment `new` je statický, takže si ho Next vezme dřív než
 * sousední `[id]`; identifikátory seznamů jsou UUID, takže se nesrazí.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('lists.createTitle') };
}

export default async function NewListPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }

  return (
    <ListCreateForm basePath={`/w/${workspaceSlug}/lists`} workspaceId={access.data.workspace.id} />
  );
}
