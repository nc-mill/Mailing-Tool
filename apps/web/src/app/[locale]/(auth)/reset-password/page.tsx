import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { confirmPasswordResetAction } from '@/features/auth/actions';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('reset.title') };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordForm action={confirmPasswordResetAction} token={token} />;
}
