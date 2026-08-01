import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { ImportWizard, type Step } from '@/features/import/import-wizard';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('import');
  return { title: t('wizard.title') };
}

const STEPS = ['upload', 'fileCheck', 'mapping', 'preview', 'options', 'progress'];

export default async function ImportPage({ params, searchParams }: PageProps) {
  const [{ locale, workspaceSlug }, query] = await Promise.all([params, searchParams]);

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    notFound();
  }
  const workspaceId = access.data.workspace.id;

  const step = typeof query['step'] === 'string' && STEPS.includes(query['step']) ? query['step'] : 'upload';
  const importId = typeof query['import'] === 'string' ? query['import'] : null;

  const lists = await apiFetch<{ data: { id: string; name: string; opt_in: 'single' | 'double' }[] }>(
    '/api/v1/lists',
    { workspaceId },
  );

  return (
    <ImportWizard
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      locale={locale}
      importId={importId}
      initialStep={step as Step}
      lists={(lists.ok ? lists.data.data : []).map((list) => ({
        id: list.id,
        name: list.name,
        optIn: list.opt_in,
      }))}
    />
  );
}
