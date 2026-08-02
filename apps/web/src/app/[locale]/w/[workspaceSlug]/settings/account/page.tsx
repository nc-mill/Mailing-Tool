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
 * Registr navigace P05 má u položky „Můj účet" cestu `/settings/account`,
 * tedy uvnitř projektu. Profil je ale osobní, ne projektový, a bydlí na
 * `/settings/profile` mimo skořápku projektu (5.3 části 1).
 *
 * Bez tohohle přesměrování by šestá položka menu vedla na 404. Registr
 * vlastní P05 a uzávěr S5 zakazuje měnit v něm cestu, takže se to řeší
 * na straně P06, jedním souborem, který nic nevykresluje.
 */
export default function WorkspaceAccountPage() {
  redirect('/settings/profile');
}
