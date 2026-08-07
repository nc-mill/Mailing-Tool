'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { cn } from '@mlain/ui/lib/cn';
import { useToast } from '@mlain/ui/patterns/toast';
import { removeDemoDataAction } from './actions';
import { DemoDataDialog, type DemoCounts, type DemoImpact } from './demo-data-dialog';

export type DemoDataState = {
  present: boolean;
  counts: DemoCounts | null;
  /** Co úklid rozváže mimo ukázkovou sadu. Viz `readDemoImpact` v jádře. */
  impact?: DemoImpact | null;
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
 * VZHLED PODLE NÁVRHU: tlumená plocha s hairline rámečkem, vlevo odznak
 * a věta, vpravo obě akce. Není to `Alert`: hláška s barevnou linkou po straně
 * patří stavu, který se stal a zase zmizí, kdežto tenhle pruh je trvalý popis
 * projektu. V `Alert` navíc akce stojí POD textem, takže se tlačítko
 * „Odstranit" roztahovalo přes celou šířku pruhu.
 *
 * Mazání jde SERVEROVOU AKCÍ, ne holým `fetch` z prohlížeče. Původní volání
 * `fetch('/api/v1/demo-data', { method: 'DELETE' })` neslo relaci, ale ne
 * projekt, a autentizace ho tím pádem odmítala se 404 (viz `actions.ts`).
 * Uživatel po každém potvrzení viděl jen hlášku, že se to nepovedlo, a data
 * v projektu zůstala.
 */
export function DemoDataBanner({
  state,
  slug,
  canRemove = true,
}: {
  state: DemoDataState;
  slug: string;
  /**
   * Smí přihlášený člověk ukázková data smazat? Rozhoduje `contacts:delete`,
   * tedy editor a výš. Prohlížející tlačítko viděl, klikl a dostal odmítnutí,
   * aniž by se dozvěděl proč. Skrýt se nesmí (pravidlo 2 z 7.2b), vysvětlí se.
   */
  canRemove?: boolean;
}) {
  const t = useTranslations('onboarding.demo');
  const router = useRouter();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const reasonId = useId();
  const reasonRef = useRef<HTMLParagraphElement | null>(null);

  if (!state.present || state.counts === null) return null;
  const counts = state.counts;
  const contactsHref =
    state.tagId == null
      ? `/w/${slug}/contacts`
      : `/w/${slug}/contacts?tag_id=${encodeURIComponent(state.tagId)}`;

  return (
    <Card
      as="div"
      tone="muted"
      padding="none"
      gap="none"
      className={cn(
        'flex-row flex-wrap items-center gap-[var(--spacing-card)]',
        'px-[var(--spacing-card-tight)] py-[var(--spacing-gutter)]',
      )}
    >
      {/* `flex-1` a `min-w-0` drží akce na stejném řádku jako text: bez nich
          se dlouhá věta roztáhne přes celou šířku pruhu a obě tlačítka spadnou
          pod ni. Zalomit se smí až tehdy, když je okno opravdu úzké. */}
      <div className="grid min-w-0 flex-1 gap-[var(--spacing-hairline)]">
        <Badge tone="accent">{t('label')}</Badge>
        <p className="text-ui text-text-muted">
          <strong className="font-semibold text-text">{t('bannerTitle')}</strong>{' '}
          {t('bannerDetail', { contacts: counts.contacts })} {t('filterHint')}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-[var(--spacing-inline)]">
        {/*
          ODKAZ, ne tlačítko s `router.push`: míří na jinou obrazovku, takže se
          musí dát otevřít prostředním tlačítkem myši i s Cmd. Vzhled tlačítka
          dodá `asChild`.
        */}
        <Button asChild size="sm">
          <Link href={contactsHref}>{t('showInContacts')}</Link>
        </Button>
        {/*
          „Odstranit" je tišší než odkaz vedle něj: nemá spodní hranu a barvu
          nebezpečí ukáže až při najetí. Pruh nemá k mazání tlačit, jen ho
          nabídnout, a potvrzení stejně řeší dialog.
        */}
        {/*
          Bez oprávnění tlačítko nemizí, jen místo okna přesune fokus na větu
          s důvodem. Tichá varianta tlačítka `unavailableReason` neumí (to je
          výsada hlasitých) a zašedit ji bez vysvětlení zakazuje kritérium 18.
        */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'border-border-strong text-text-muted',
            'hover:border-danger hover:bg-transparent hover:text-danger-text',
          )}
          data-testid="demo-remove"
          {...(canRemove ? {} : { 'aria-describedby': reasonId })}
          onClick={() => {
            if (canRemove) {
              setDialogOpen(true);
              return;
            }
            reasonRef.current?.focus();
          }}
        >
          {t('remove')}
        </Button>
      </div>

      {canRemove ? null : (
        <p
          id={reasonId}
          ref={reasonRef}
          tabIndex={-1}
          data-testid="demo-remove-forbidden"
          className="w-full text-meta text-text-muted"
        >
          {t('removeForbidden')}
        </p>
      )}

      <DemoDataDialog
        open={dialogOpen}
        counts={counts}
        impact={state.impact}
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
    </Card>
  );
}
