import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ContactsProblem } from '@/features/contacts/contacts-problem';
import { FormsScreen } from '@/features/forms/forms-screen';
import type { FormView, ListOption } from '@/features/forms/types';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. Bez
 * tohohle ji Next při `next build` vykreslí a spadne na chybějící relaci; totéž
 * hlídá `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('forms.title') };
}

export default async function FormsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <ContactsProblem problem={access.problem} />;
  }
  const workspaceId = access.data.workspace.id;

  const [forms, lists] = await Promise.all([
    apiFetch<{ data: FormView[] }>('/api/v1/forms', { workspaceId }),
    apiFetch<{ data: ListOption[] }>('/api/v1/lists', { workspaceId }),
  ]);
  if (!forms.ok) return <ContactsProblem problem={forms.problem} />;

  return (
    <FormsScreen
      forms={forms.data.data}
      // Seznamy se při selhání degradují na prázdno, ne na chybovou stránku:
      // výpis formulářů má smysl i tehdy, když se zrovna nepodařilo načíst seznamy,
      // jen v něm nepůjde nový formulář rovnou navázat.
      lists={lists.ok ? lists.data.data : []}
      workspaceId={workspaceId}
      basePath={`/w/${workspaceSlug}/forms`}
      canEdit={access.data.permissions.includes('contacts:write')}
    />
  );
}
