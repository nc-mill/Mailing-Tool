import { CampaignReport } from '@/features/reports/report/campaign-report';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  // Segment se jmenuje `id`, ne `campaignId`: Next.js nedovolí dvě různá
  // jména pro tutéž dynamickou cestu a sourozenci `send` i `progress` už
  // `id` používaly. Rozdíl shodil celou aplikaci na 500, ne jen tuhle stránku.
  const { workspaceSlug, id: campaignId } = await params;
  return <CampaignReport workspaceSlug={workspaceSlug} campaignId={campaignId} />;
}
