import { CampaignTrend } from '@/features/reports/stats/campaign-trend';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function CampaignStatsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <CampaignTrend workspaceSlug={workspaceSlug} />;
}
