'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { ChevronRight } from '@mlain/ui/icons';

/**
 * Drobečky nad obrazovkami jedné kampaně: odkaz zpátky na seznam, šipka
 * a jméno té kampaně, ve které uživatel je.
 *
 * Není to komponenta designového systému a nemá jí být: jsou to podle návrhu
 * dva prvky a šipka mezi nimi. Do `PageHeader` se předává jako `breadcrumbs`.
 * Bydlí tady, protože ji potřebují všechny tři obrazovky kampaně (editor,
 * nastavení a report) a tři kopie téhož by se rozešly.
 *
 * Jméno kampaně je mono: je to údaj, ne věta, a čte se po znacích stejně jako
 * meta řádek pod nadpisem.
 */
export function CampaignBreadcrumbs({
  basePath,
  campaignName,
}: {
  basePath: string;
  campaignName: string;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');

  return (
    <nav
      aria-label={tc('a11y.breadcrumbs')}
      className="flex items-center gap-2 [&_a]:text-accent-text"
    >
      <Link href={`${basePath}/campaigns`} className="text-sm underline-offset-[3px]">
        {t('list.title')}
      </Link>
      <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
      <span className="min-w-0 truncate font-mono text-meta text-text-muted">{campaignName}</span>
    </nav>
  );
}
