import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { loginAction } from '@/features/auth/actions';
import { LoginForm } from '@/features/auth/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('login.title') };
}

/**
 * Hodnota `next` se propouští jen tehdy, když začíná jedním lomítkem.
 * `//zlo.cz` je platná relativní adresa protokolu a přesměrovala by uživatele
 * na cizí web. Kontrola je na obou stranách, ve stránce i v akci, protože
 * formulář jde odeslat i mimo stránku.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;
  return <LoginForm action={loginAction} next={safeNext} />;
}
