import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { CleanupScenario, type CleanupStep } from '@/features/segments/cleanup-scenario';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('segments');
  return { title: t('cleanup.title') };
}

const STEPS = ['freeze', 'action', 'countdown', 'confirm'];

export default async function CleanupPage({ params, searchParams }: PageProps) {
  const [{ locale, workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  const step =
    typeof query['step'] === 'string' && STEPS.includes(query['step']) ? query['step'] : 'freeze';
  const segmentName = typeof query['segment'] === 'string' ? query['segment'] : '';

  return (
    <CleanupScenario
      step={step as CleanupStep}
      segment={{ name: segmentName, count: 0 }}
      role={access.data.role}
      locale={locale}
    />
  );
}
