'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Alert } from '@mlain/ui/patterns/states';
import {
  PageChoice,
  pageChoiceOf,
  type PageChoiceValue,
  type PageOption,
} from '@/features/forms/page-choice';
import { pageDocument } from '@/features/forms/page-document';
import {
  createListPageAction,
  saveListPageChoiceAction,
  type ListPageSurface,
} from './list-email-actions';

/**
 * Stav jednoho kroku tak, jak ho vydává API seznamu. Prázdný řetězec u adresy
 * je „nevyplněno", protože s ním pracují formulářová pole.
 */
export type ListPageState = {
  surface: ListPageSurface;
  templateId: string | null;
  redirectUrl: string;
};

/**
 * KARTA „STRÁNKY PRO NÁVŠTĚVNÍKA" NA NASTAVENÍ SEZNAMU.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíly 2.1 a 3. Tři kroky, u každého tatáž trojice voleb jako na formuláři.
 *
 * PŘESMĚROVÁNÍ TU NENÍ VEDLE STRÁNKY, ALE MÍSTO NÍ. Dřív to byla tři samostatná
 * pole s adresou; jako čtvrtá možnost vedle nové volby by se daly nastavit obě
 * naráz a rozhodla by veřejná trasa, ne uživatel. Adresy se proto nikam
 * neztratily, jen se z nich stala jedna ze tří voleb téhož kroku.
 *
 * U POTVRZENÍ A U „UŽ JE PŘIHLÁŠENÝ" MÁ PŘEDNOST FORMULÁŘ. Musí to být napsané
 * na obrazovce: kdo si nastaví stránku na seznamu a uvidí jinou, jinak nemá jak
 * přijít na to, že vyhrál formulář, ze kterého přihlášení přišlo.
 */
export function ListPages({
  listId,
  listName,
  workspaceId,
  templatesPath,
  pages,
  states,
  unsubscribeScope,
}: {
  listId: string;
  /** Jméno seznamu. Je z něj název nově založené stránky. */
  listName: string;
  workspaceId: string;
  /** Kam vede editor, tedy `/w/{slug}/templates`. */
  templatesPath: string;
  /** Knihovna veřejných stránek projektu. Sdílená, odkaz je u seznamu vlastní. */
  pages: PageOption[];
  states: ListPageState[];
  /** Globální rozsah odhlášení mění, co se o stránce po odhlášení dá slíbit. */
  unsubscribeScope: 'list' | 'global';
}) {
  const t = useTranslations('contacts');
  const tp = useTranslations('forms.pages');
  const locale = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState<ListPageSurface | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  const editHref = (surface: ListPageSurface) => (templateId: string) =>
    `${templatesPath}/${templateId}?surface=${surface}`;

  /**
   * Dnešní znění kroku. Bere se z týchž klíčů, které vykresluje veřejná stránka,
   * takže nově založený návrh začíná přesně na tom, co by člověk uviděl jinak.
   *
   * Název seznamu se dosazuje jako PROMĚNNÁ `{{ data.list_name }}`, ne jako
   * pevné slovo: stránka může sloužit víc seznamům a zapečený název by
   * u druhého lhal.
   */
  function copyFor(surface: ListPageSurface): { title: string; body: string } {
    const list = '{{ data.list_name }}';
    if (surface === 'confirmed') {
      return { title: t('public.confirm.doneTitle'), body: t('public.confirm.doneBody', { list }) };
    }
    if (surface === 'already_subscribed') {
      return {
        title: t('public.confirm.already_usedTitle'),
        body: t('public.confirm.already_usedBody', { list }),
      };
    }
    return {
      title: t('public.unsubscribe.doneList', { list }),
      body: t('public.unsubscribe.inFlightNotice'),
    };
  }

  async function change(surface: ListPageSurface, next: PageChoiceValue) {
    setFailed(false);
    const result = await saveListPageChoiceAction({
      workspaceId,
      listId,
      surface,
      // Trojice je JEDNA volba, takže se druhá možnost vždycky nuluje.
      templateId: next.mode === 'page' ? next.templateId : null,
      redirectUrl: next.mode === 'redirect' ? next.redirectUrl : null,
    });
    // Neúspěch se MUSÍ ozvat. Tichý neúspěch je přesně ta vada, kvůli které
    // se tahle obrazovka předělávala.
    if (result.status === 'error') {
      setSaved(false);
      setFailed(true);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function create(surface: ListPageSurface, title: string) {
    setCreating(surface);
    setFailed(false);
    try {
      const copy = copyFor(surface);
      const name = tp('newName', { title, owner: listName }).slice(0, 120);
      const result = await createListPageAction({
        workspaceId,
        listId,
        surface,
        name,
        document: pageDocument({ name, language: locale, ...copy }),
      });
      if (result.status === 'error' || result.templateId === undefined) {
        setFailed(true);
        return;
      }
      // Uživatel klikl „vytvořit stránku", takže dalším krokem je navrhování.
      router.push(editHref(surface)(result.templateId));
    } finally {
      setCreating(null);
    }
  }

  const rows: { surface: ListPageSurface; title: string; hint: string }[] = [
    {
      surface: 'confirmed',
      title: t('lists.pagesConfirmed'),
      hint: t('lists.pagesConfirmedHint'),
    },
    {
      surface: 'already_subscribed',
      title: t('lists.pagesAlreadySubscribed'),
      hint: t('lists.pagesAlreadySubscribedHint'),
    },
    {
      surface: 'unsubscribed',
      title: t('lists.pagesUnsubscribed'),
      // Globální rozsah přesměrování ani stránku nepoužije, takže se to musí
      // říct tady a ne až na tom, že se nastavení „neprojevilo".
      hint:
        unsubscribeScope === 'global'
          ? t('lists.unsubscribeRedirectHintGlobal')
          : t('lists.pagesUnsubscribedHint'),
    },
  ];

  return (
    <Card gap="gutter" data-testid="list-pages-section">
      <CardTitle>{t('lists.pagesTitle')}</CardTitle>
      <p className="text-meta text-text-muted">{t('lists.pagesLead')}</p>
      {rows.map((row) => {
        const state = states.find((item) => item.surface === row.surface) ?? {
          surface: row.surface,
          templateId: null,
          redirectUrl: '',
        };
        return (
          <PageChoice
            key={row.surface}
            name={`list-page-${row.surface.replace(/_/g, '-')}`}
            title={row.title}
            hint={row.hint}
            value={pageChoiceOf({
              templateId: state.templateId,
              redirectUrl: state.redirectUrl,
            })}
            options={pages}
            canEdit
            editHref={editHref(row.surface)}
            creating={creating === row.surface}
            onChange={(next) => void change(row.surface, next)}
            onCreate={() => void create(row.surface, row.title)}
          />
        );
      })}
      {failed ? (
        <Alert tone="error" data-testid="list-pages-failed">
          {t('lists.basicsFailed')}
        </Alert>
      ) : null}
      {saved && !failed ? (
        <p role="status" className="text-sm text-success-text">
          {t('lists.basicsSaved')}
        </p>
      ) : null}
    </Card>
  );
}
