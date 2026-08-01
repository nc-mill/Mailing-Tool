'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OnboardingStep } from '@mlain/core/onboarding';

/**
 * Jeden krok seznamu. Hotový krok je označený znakem, textem pro čtečku
 * i atributem, takže se nepozná jen barvou (pravidlo 11.3 části 6).
 */
export function OnboardingStepRow({ step, slug }: { step: OnboardingStep; slug: string }) {
  const t = useTranslations(`onboarding.steps.${step.id}`);
  const shared = useTranslations('onboarding.panel');

  return (
    <li aria-current="false" className="flex items-start gap-3 border-b border-border py-3">
      <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
      <div className="flex-1">
        <p className="font-medium">
          {t('title')}
          {step.done ? <span className="sr-only"> {shared('done')}</span> : null}
        </p>
        <p className="text-sm text-text-muted">{t('description')}</p>
      </div>
      <span className="text-sm text-text-muted">{t('estimate')}</span>
      <Link href={`/w/${slug}/${step.href}`}>{t('action')}</Link>
      {step.secondaryHref === null ? null : (
        <Link href={`/w/${slug}/${step.secondaryHref}`}>{t('secondaryAction')}</Link>
      )}
    </li>
  );
}
