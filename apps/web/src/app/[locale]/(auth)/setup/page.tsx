import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@mlain/i18n/locales';
import { setupAction } from '@/features/auth/actions';
import { SetupForm } from '@/features/auth/setup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('setup.title') };
}

export default function SetupPage() {
  return <SetupForm action={setupAction} locales={SUPPORTED_LOCALES} />;
}
