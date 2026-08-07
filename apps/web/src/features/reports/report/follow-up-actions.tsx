'use client';

import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';
import { useRouter } from '@mlain/i18n/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { duplicateCampaignAction } from '@/features/campaigns/actions';

export function FollowUpActions({
  workspaceId,
  workspaceSlug,
  campaignId,
}: {
  /** Duplikace je zápis a ten se adresuje projektem, ne jeho jménem v adrese. */
  workspaceId: string;
  workspaceSlug: string;
  campaignId: string;
}) {
  const t = useTranslations('reports');
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const base = `/w/${workspaceSlug}`;

  /**
   * DUPLIKACE JE AKCE, NE ODKAZ.
   *
   * Dřív to byl `<Link>` na `/campaigns/new?duplicate={id}`, jenže ten parametr
   * nečte žádná stránka, takže se otevřel prázdný průvodce a uživatel začal od
   * nuly, přestože klikl na „Duplikovat kampaň". `POST /campaigns/{id}/duplicate`
   * přitom existuje a kopíruje i pracovní obsah.
   *
   * Odchází se ROVNOU DO KOPIE, stejně jako z nabídky „…" v seznamu kampaní.
   * Kopie je `draft` se jménem „… (kopie)" a v seznamu by se ztratila mezi
   * ostatními; kdo duplikuje odeslanou kampaň, ji navíc chce hned upravit.
   * Přechod je tedy zpětná vazba i další krok naráz, proto se nehlásí ještě
   * oznámením: obrazovka kopie je zpráva sama.
   */
  function duplicate() {
    startTransition(async () => {
      const result = await duplicateCampaignAction({ workspaceId, campaignId });
      if (result.status !== 'success') {
        toast.error(t('report.actions.duplicateFailed', { detail: result.code }));
        return;
      }
      router.push(`${base}/campaigns/${result.campaignId}`);
    });
  }

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
      <Button
        variant="secondary"
        size="sm"
        data-testid="report-duplicate"
        onClick={duplicate}
        aria-busy={pending}
      >
        {t('report.actions.duplicate')}
      </Button>
      {/*
        TLAČÍTKO „POSLAT ZNOVU NEOTEVŘEVŠÍM" TU UŽ NENÍ, a je to úmysl.

        Vedlo na `/campaigns/new?resend_unopened={id}`, tedy na adresu, kterou
        nikdo nečte, takže neudělalo nic. Napojit ho na duplikaci nešlo:
        `POST /campaigns/{id}/duplicate` kopíruje PŮVODNÍ publikum, ne zúžené na
        ty, kdo neotevřeli. Tlačítko s tímhle nápisem by tedy vyrobilo kampaň
        adresovanou znovu VŠEM, což je horší než mrtvý odkaz: mrtvý odkaz nic
        neudělá, tenhle by celému seznamu poslal druhý e-mail.

        Táž práce jde udělat dvěma kroky, které stojí hned vedle: „Vytvořit
        segment z těch, kdo neotevřeli" a „Duplikovat kampaň", a pak v kroku 2
        kopie přepnout publikum na ten segment. Udělat z toho jedno kliknutí
        znamená novou schopnost API (duplikace se zúženým publikem), tedy funkci,
        ne dodělání zbytku.

        Věta o nepřesnosti otevření zůstává: platí i pro segment neotevřevších,
        který na týchž číslech stojí.
      */}
      <p className="w-full text-meta text-text-muted">{t('report.actions.resendWarning')}</p>
    </section>
  );
}
