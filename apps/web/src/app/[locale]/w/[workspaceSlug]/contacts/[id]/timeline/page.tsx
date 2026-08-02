import { ContactTimeline } from '@/features/reports/timeline/contact-timeline';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal cestu
 * `contacts/[contactId]/timeline`. Detail kontaktu ale vlastní P07 a ten už
 * má `contacts/[id]`. Next.js dva různé názvy parametru na téže úrovni
 * odmítá („You cannot use different slug names for the same dynamic path"),
 * takže by ta dvojice shodila celou aplikaci, ne jen tuhle stránku.
 * Adresa `/w/{slug}/contacts/{id}/timeline` zůstává stejná.
 */
export default async function ContactTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  // Zóna se NEPOČÍTÁ tady. Serverová komponenta zná jen zónu serveru a hodnota
  // by se lišila od té, ve které uživatel doopravdy je. Komponenta si ji bere
  // z `useTimeZone()`, tedy z providera, který skořápka plní z profilu.
  return <ContactTimeline contactId={contactId} />;
}
