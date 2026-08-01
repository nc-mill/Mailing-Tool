'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';
import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';
import { DemoDataDialog, type DemoCounts } from './demo-data-dialog';

export type DemoDataState = {
  present: boolean;
  counts: DemoCounts | null;
  /**
   * Identifikátor štítku „Ukázková data". Tabulka kontaktů filtruje podle
   * `tag_id`, ne podle jména štítku (viz `features/contacts/filters.ts`),
   * takže bez něj by odkaz vedl na nefiltrovaný seznam.
   */
  tagId?: string | null;
};

/**
 * Trvalý pruh, dokud jsou ukázková data v projektu. Vedle tlačítka
 * „Odstranit" nabízí i odkaz na hromadný výběr přes štítek, aby šlo sadu
 * smazat i po částech, tedy tak, jak to žádá rozhodnutí zadavatele Z2.
 */
export function DemoDataBanner({ state, slug }: { state: DemoDataState; slug: string }) {
  const t = useTranslations('onboarding.demo');
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!state.present || state.counts === null) return null;
  const counts = state.counts;
  const contactsHref =
    state.tagId == null
      ? `/w/${slug}/contacts`
      : `/w/${slug}/contacts?tag_id=${encodeURIComponent(state.tagId)}`;

  return (
    <Alert tone="info">
      <p>
        <strong>{t('bannerTitle')}</strong> {t('bannerDetail', { contacts: counts.contacts })}
      </p>
      <p>
        <Link href={contactsHref}>{t('filterHint')}</Link>
      </p>
      <Button variant="secondary" onClick={() => setDialogOpen(true)}>
        {t('remove')}
      </Button>
      <DemoDataDialog
        open={dialogOpen}
        counts={counts}
        onCancel={() => setDialogOpen(false)}
        onConfirm={async () => {
          setDialogOpen(false);
          const res = await fetch('/api/v1/demo-data', { method: 'DELETE' });
          if (res.ok) toast.success(t('removed'));
          else toast.error(t('removeFailed'));
        }}
      />
    </Alert>
  );
}
