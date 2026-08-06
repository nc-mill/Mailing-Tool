import type { OnboardingState } from '@mlain/core/onboarding';
import { DashboardGrid } from '@/features/reports/dashboard/dashboard-grid';
import { DemoDataBanner, type DemoDataState } from '@/features/onboarding/demo-data-banner';
import { OnboardingPanel } from '@/features/onboarding/onboarding-panel';
import { apiFetch } from '@/lib/api-client/fetch';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

/**
 * Přehled projektu. Nad dlaždicemi jsou dvě věci, které tu dřív chyběly,
 * přestože obě komponenty existovaly a byly otestované: panel prvních kroků
 * a pruh o ukázkových datech (rozhraní I→P14.1).
 *
 * Nikdo je nezapojil, takže na Přehledu nebyl jediný `role="region"` a nový
 * uživatel po instalaci neviděl, co má dělat dál. Odhaleno až průchodem zlatou
 * cestou, protože jednotkové testy obou komponent celou dobu procházely: měřily
 * je izolovaně a o tom, jestli je někdo vykresluje, nevěděly nic.
 *
 * Obě čtení běží NARÁZ, aby vedle sebe nevznikl vodopád dvou požadavků.
 * Selhání kteréhokoli z nich Přehled neshodí, jen se ten kus nevykreslí:
 * dlaždice jsou důležitější než pobídka k prvním krokům.
 */
export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  // `workspaceId` se MUSÍ předat. Autentizace skládá projekt z hlavičky
  // `X-Workspace-Id`, nebo ze segmentu `/w/{slug}` v cestě, jenže volání ze
  // serveru míří na `/api/v1/onboarding`, kde žádný takový segment není.
  // Bez něj vrací API 404 a panel se nikdy nevykreslí:
  //
  //   route:"/api/v1/onboarding", status:404, workspace_id:null
  //
  // Relační cookie přikládá `apiFetch` sám, takže se řeší jen projekt.
  const [onboarding, demo] = await Promise.all([
    apiFetch<{ data: OnboardingState }>('/api/v1/onboarding', { workspaceId: workspaceSlug }),
    apiFetch<{ data: DemoDataState }>('/api/v1/demo-data', { workspaceId: workspaceSlug }),
  ]);

  // Selhání se LOGUJE, nepřeskakuje se potichu.
  //
  // Samotné `{x.ok && <Component/>}` je tichý přeskok: když čtení vždycky
  // selže, komponenta se nikdy nevykreslí a nikde se to neukáže, takže to
  // vypadá jako by tam nikdy neměla být. Přesně tak se tady schovala 404 výš.
  // Prázdný Přehled je pořád lepší než rozbitý, ale musí být poznat, že se
  // něco nepovedlo.
  if (!onboarding.ok) {
    console.error('Přehled: onboarding se nenačetl', onboarding.problem);
  }
  if (!demo.ok) {
    console.error('Přehled: stav ukázkových dat se nenačetl', demo.problem);
  }

  return (
    // Panel prvních kroků a pruh ukázkových dat jsou SEKCE nad obrazovkou,
    // proto `--spacing-section` (25 px), tedy tatáž mezera, jakou si pod sebe
    // píše `PageHeader`. Rytmus stránky pak drží i tehdy, když je nad hlavičkou
    // jeden pruh, oba, nebo žádný.
    <div className="flex flex-col gap-[var(--spacing-section)]">
      {onboarding.ok && <OnboardingPanel state={onboarding.data.data} slug={workspaceSlug} />}
      {demo.ok && <DemoDataBanner state={demo.data.data} slug={workspaceSlug} />}
      <DashboardGrid workspaceSlug={workspaceSlug} />
    </div>
  );
}
