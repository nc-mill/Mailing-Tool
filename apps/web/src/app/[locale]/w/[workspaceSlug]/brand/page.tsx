import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BrandScreen } from '@/features/brand/brand-screen';

/**
 * Stránka se NEPŘEDRENDEROVÁVÁ. Proxy razítkuje inline skripty Nextu nonce,
 * který vzniká pro každý požadavek, kdežto předrenderované HTML vzniká při
 * stavbě, kdy žádný požadavek není. Prohlížeč by pak skripty bez nonce
 * zablokoval, React by se nenamountoval a na stránce by nefungovalo nic.
 * Hlídá to `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

/**
 * Adresa z registru navigace P05 (položka `templates-brand`, `mvp0: true`).
 * Bez téhle stránky by položka „Značka projektu" v menu vedla na 404.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai');
  return { title: t('brand.title') };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <BrandScreen workspaceSlug={workspaceSlug} />;
}
