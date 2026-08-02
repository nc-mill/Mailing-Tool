'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function FollowUpActions({
  workspaceSlug,
  campaignId,
}: {
  workspaceSlug: string;
  campaignId: string;
}) {
  const t = useTranslations('reports');
  const base = `/w/${workspaceSlug}`;

  return (
    // Akce jsou tlačítka, ne věta z odkazů: v tomhle pořadí je uživatel čte
    // jako nabídku dalšího kroku, ne jako pokračování textu nad nimi.
    <section
      aria-label={t('report.title')}
      className="flex flex-wrap items-center gap-3 [&>a]:inline-flex [&>a]:min-h-6 [&>a]:items-center [&>a]:rounded [&>a]:border [&>a]:border-border [&>a]:bg-surface [&>a]:px-3 [&>a]:py-2 [&>a]:text-sm"
    >
      {/* Segment vzniká v části 2, sem patří jen předvyplněný odkaz. */}
      <Link href={`${base}/segments/new?from_campaign=${campaignId}&preset=clicked`}>
        {t('report.actions.segmentFromClicked')}
      </Link>
      <Link href={`${base}/segments/new?from_campaign=${campaignId}&preset=not_opened`}>
        {t('report.actions.segmentFromNotOpened')}
      </Link>
      <Link href={`${base}/campaigns/new?duplicate=${campaignId}`}>
        {t('report.actions.duplicate')}
      </Link>
      <Link href={`${base}/campaigns/new?resend_unopened=${campaignId}`}>
        {t('report.actions.resendToUnopened')}
      </Link>
      <p className="w-full text-xs text-text-muted">{t('report.actions.resendWarning')}</p>
    </section>
  );
}
