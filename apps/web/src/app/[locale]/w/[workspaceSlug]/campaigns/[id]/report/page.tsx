import { notFound } from 'next/navigation';
import { loadConfig } from '@mlain/core/config';
import { classifyTrackingDomain } from '@mlain/core/tracking';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { CampaignLoadProblem } from '@/features/campaigns/campaign-load-problem';
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

  /*
   * EXISTENCI KAMPANĚ OVĚŘUJE SERVER, ne až komponenta v prohlížeči.
   *
   * Dřív tu žádná kontrola nebyla: data si tahal až klientský `CampaignReport`,
   * takže vymyšlené `id` vrátilo 200 a uživatel dostal rozbitý report s nulami
   * a chybovou hláškou uvnitř místo poctivé 404. Ze stavu stránky se pak nedalo
   * poznat, jestli kampaň neexistuje, nebo jen nemá čísla.
   *
   * 404 SE ALE POSÍLÁ JEN Z OPRAVDOVÉ 404. Vypršení požadavku (`apiFetch` má
   * desetisekundový limit), nedostupné API i vnitřní chyba nic neříkají o tom,
   * jestli kampaň existuje, a věta „stránka nenalezena" by z nich udělala
   * tvrzení, že kampaň zmizela. Tyhle případy patří do chybového bloku s kódem
   * a číslem požadavku, viz `CampaignLoadProblem`; je to táž oprava, jakou už
   * dostala obrazovka nastavení kampaně a obrazovka odeslání.
   *
   * Načítá se detail kampaně, ne její statistiky: report umí žít i s tím, že
   * čísla ještě nedoběhla, ale nesmí se otevřít nad kampaní, která není.
   */
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    // Nečlen projektu dál dostane 404, ta je správně (3.4 části 1).
    if (access.problem.status === 404) notFound();
    return <CampaignLoadProblem problem={access.problem} occurredAt={new Date().toISOString()} />;
  }

  const campaign = await apiFetch<{ id: string }>(`/api/v1/campaigns/${campaignId}`, {
    workspaceId: access.data.workspace.id,
  });
  if (!campaign.ok) {
    if (campaign.problem.status === 404) notFound();
    return <CampaignLoadProblem problem={campaign.problem} occurredAt={new Date().toISOString()} />;
  }

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
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      {reach.kind === 'public' ? null : (
        <UnreachableDomainAlert kind={reach.kind} host={reach.host} variant="report" />
      )}
      <CampaignReport workspaceSlug={workspaceSlug} campaignId={campaignId} />
    </div>
  );
}
