import { loadConfig } from '@mlain/core/config';
import { classifyTrackingDomain } from '@mlain/core/tracking';
import { WebActivityScreen } from '@/features/reports/web/web-activity-screen';
import { UnreachableDomainAlert } from '@/features/tracking/unreachable-domain-alert';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

export default async function WebActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  /*
   * Pruh o nedosažitelné měřicí doméně stojí NAD obrazovkou.
   *
   * Na téhle obrazovce je nejdůležitější ze všech: když `TRACKING_DOMAIN`
   * míří na `localhost`, měřicí značka na skutečném webu nemá kam odesílat
   * a obrazovka bude prázdná bez ohledu na to, kolik lidí web navštívilo.
   * Prázdno bez vysvětlení vypadá jako rozbité měření.
   *
   * Vykresluje se tady, protože `WebActivityScreen` je klientská komponenta
   * a konfiguraci instalace přečte jen server.
   */
  const reach = classifyTrackingDomain(loadConfig().TRACKING_DOMAIN);

  return (
    <div className="space-y-6">
      {reach.kind === 'public' ? null : (
        <UnreachableDomainAlert kind={reach.kind} host={reach.host} variant="settings" />
      )}
      <WebActivityScreen workspaceSlug={workspaceSlug} />
    </div>
  );
}
