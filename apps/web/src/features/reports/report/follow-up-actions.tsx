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
      className={[
        'flex flex-wrap items-center gap-[var(--spacing-inline)]',
        // Odkazy vypadají jako tlačítka v liště: rámeček, 36 px, bez podtržení.
        '[&>a]:inline-flex [&>a]:items-center [&>a]:no-underline',
        '[&>a]:min-h-[var(--size-control-sm)] [&>a]:px-3 [&>a]:py-2',
        '[&>a]:rounded-[var(--radius-control)] [&>a]:border [&>a]:border-border',
        '[&>a]:bg-surface [&>a]:text-sm [&>a]:text-text-muted',
        '[&>a]:transition-colors [&>a]:duration-[var(--duration-fast)]',
        '[&>a:hover]:bg-surface-muted [&>a:hover]:text-text',
      ].join(' ')}
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
      <p className="w-full text-meta text-text-muted">{t('report.actions.resendWarning')}</p>
    </section>
  );
}
