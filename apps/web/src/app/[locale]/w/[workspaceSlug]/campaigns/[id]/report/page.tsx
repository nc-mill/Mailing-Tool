import { loadConfig } from '@mlain/core/config';
import { classifyTrackingDomain } from '@mlain/core/tracking';
import { CampaignReport } from '@/features/reports/report/campaign-report';
import { UnreachableDomainAlert } from '@/features/tracking/unreachable-domain-alert';

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

  /**
   * Pruh o nedosažitelné měřicí doméně stojí NAD reportem, ne uvnitř něj.
   *
   * Bez něj ukáže report nula otevření a uživatel z toho usoudí, že je měření
   * rozbité. Rozbité není: `TRACKING_DOMAIN` míří na `localhost`, pixel stahuje
   * server poštovní služby (Gmail přes vlastní proxy) a ten na `localhost`
   * nedosáhne, takže z Gmailu nedorazí ani jedno otevření. Je to vlastnost
   * prostředí, ne vada kampaně, a produkt to musí říct sám.
   *
   * Vykresluje se tady, protože `CampaignReport` je klientská komponenta
   * a konfiguraci instalace přečte jen server.
   */
  const reach = classifyTrackingDomain(loadConfig().TRACKING_DOMAIN);

  return (
    <div className="space-y-6">
      {reach.kind === 'public' ? null : (
        <UnreachableDomainAlert kind={reach.kind} host={reach.host} variant="report" />
      )}
      <CampaignReport workspaceSlug={workspaceSlug} campaignId={campaignId} />
    </div>
  );
}
