'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Alert } from '@mlain/ui/patterns/states';
import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';
import { removeDemoDataAction } from './actions';
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
 *
 * Mazání jde SERVEROVOU AKCÍ, ne holým `fetch` z prohlížeče. Původní volání
 * `fetch('/api/v1/demo-data', { method: 'DELETE' })` neslo relaci, ale ne
 * projekt, a autentizace ho tím pádem odmítala se 404 (viz `actions.ts`).
 * Uživatel po každém potvrzení viděl jen hlášku, že se to nepovedlo, a data
 * v projektu zůstala.
 */
export function DemoDataBanner({ state, slug }: { state: DemoDataState; slug: string }) {
  const t = useTranslations('onboarding.demo');
  const router = useRouter();
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
          const result = await removeDemoDataAction({ workspaceRef: slug });
          if (result.status === 'error') {
            toast.error(t('removeFailed', { code: result.code }));
            return;
          }
          toast.success(t('removed'));
          // Pruh visí na serverové stránce, takže bez tohohle by po smazání
          // zůstal na obrazovce i s počty položek, které už neexistují.
          router.refresh();
        }}
      />
    </Alert>
  );
}
