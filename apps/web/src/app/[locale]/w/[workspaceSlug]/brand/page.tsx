import { redirect } from 'next/navigation';

/**
 * Stará adresa značky. Obrazovka se 4. 8. 2026 přestěhovala do Nastavení
 * (rozhodnutí zadavatele, zapsané v `packages/ui/src/patterns/navigation/registry.ts`),
 * takže tady zůstává jen přesměrování na `/settings/brand`.
 *
 * Proč se `/brand` nesmazalo: adresu nesla položka menu od P05, je v plánech,
 * v komentářích i v prohlížečích lidí, kteří si ji uložili. Tichá 404 by je
 * poslala na obrazovku „Stránka nenalezena" a nikdo by jim neřekl, kam se
 * značka poděla. Přesměrování stojí pět řádků.
 *
 * Tělo obrazovky (`BrandScreen`) je teď jen na jednom místě, pod
 * `settings/brand/page.tsx`. Dvě stránky nad jedním tělem byly zvyk z doby,
 * kdy položka menu mířila na `/brand` a e2e na `/settings/brand`.
 *
 * `dynamic = 'force-dynamic'` tu je i pro přesměrování: hlídá to
 * `apps/web/test/ci/no-static-pages.test.ts` a rozhodnutí má být napsané,
 * ne uhodnuté Nextem.
 */
export const dynamic = 'force-dynamic';

export default async function BrandPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  redirect(`/${locale}/w/${workspaceSlug}/settings/brand`);
}
