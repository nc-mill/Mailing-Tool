import { redirect } from 'next/navigation';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

/**
 * Přesměrování `/settings/account` na `/settings/profile`.
 *
 * VZNIKLO PROTO, že registr navigace měl položku „Můj účet" s cestou uvnitř
 * projektu, kdežto profil je osobní a bydlí mimo skořápku (5.3 části 1). Bez
 * přesměrování by položka menu vedla na 404.
 *
 * Ta položka je od 6. 8. 2026 z registru pryč (rozhodnutí zadavatele: do účtu
 * se chodí jen nabídkou v pravém horním rohu), takže na tuhle adresu už nic
 * z aplikace neodkazuje. Soubor ZŮSTÁVÁ kvůli uloženým odkazům a záložkám:
 * je to jeden řádek a bez něj by z nich byla 404.
 *
 * Slug projektu se přenáší do `?from`, aby hlavička profilu věděla, kam vede
 * cesta zpět. Jinak by uživatel, který na profil došel touhle cestou, skončil
 * u prvního projektu v seznamu místo toho, ze kterého odešel.
 */
export default async function WorkspaceAccountPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/settings/profile?from=${encodeURIComponent(workspaceSlug)}`);
}
