'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { createFormPageAction, type FormPageField } from './actions';
import { PageChoice, pageChoiceOf, type PageChoiceValue } from './page-choice';
import { pageDocument } from './page-document';
import type { FormView, TemplateOption } from './types';

/**
 * KARTA „STRÁNKY PRO NÁVŠTĚVNÍKA" NA DETAILU FORMULÁŘE.
 *
 * Plán: docs/superpowers/plans/2026-08-07-designovatelne-verejne-stranky.md,
 * oddíl 2.1. Tři kroky, u každého tatáž trojice voleb.
 *
 * PŘESMĚROVÁNÍ JDE NASTAVIT JEN U PRVNÍHO KROKU, a není to nedodělek. Formulář
 * má vlastní `redirect_url` právě jednu, pro děkovací stránku. Kam poslat
 * člověka po potvrzení a když už přihlášený je, se rozhoduje na seznamu
 * (`confirm_redirect_url`, `already_subscribed_redirect_url`), protože se na ty
 * stránky chodí z odkazu v e-mailu. Volba proto zůstává vidět a vypnutá,
 * s větou, kde se nastavuje: schovat ji by znamenalo, že kdo ji hledá, usoudí,
 * že to produkt neumí.
 */
export function FormVisitorPages({
  form,
  pages,
  workspaceId,
  workspaceSlug,
  canEdit,
  save,
  onFailure,
}: {
  form: FormView;
  /** Celá knihovna stránek projektu. Sdílet jde, odkaz je u formuláře vlastní. */
  pages: TemplateOption[];
  workspaceId: string;
  workspaceSlug: string;
  canEdit: boolean;
  /** Uložení dílčí změny formuláře. Vlastní ho `FormEditor`, ať je jedno. */
  save: (body: {
    thanks_template_id?: string | null;
    confirmed_template_id?: string | null;
    already_subscribed_template_id?: string | null;
    redirect_url?: string | null;
  }) => Promise<boolean>;
  onFailure: (message: string) => void;
}) {
  const t = useTranslations('forms.pages');
  const tc = useTranslations('contacts');
  const locale = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState<FormPageField | null>(null);

  /**
   * Adresa editoru NESE POVRCH. Bez `?surface=` spadne editor na nejužší povrch
   * `form_thanks`, který o návštěvníkovi neví nic, a stránka po potvrzení by
   * hlásila údaje kontaktu jako chybu, přestože je na ní mít smí. Je to záměr
   * editoru: nezapojený parametr se má projevit hláškou, ne prázdným místem
   * u návštěvníka.
   */
  const SURFACE: Record<FormPageField, string> = {
    thanks_template_id: 'form_thanks',
    confirmed_template_id: 'confirmed',
    already_subscribed_template_id: 'already_subscribed',
  };

  const editHref = (field: FormPageField) => (templateId: string) =>
    `/w/${workspaceSlug}/templates/${templateId}?surface=${SURFACE[field]}`;

  /**
   * Dnešní znění kroku. Bere se z týchž klíčů, které vykresluje veřejná stránka,
   * takže nově založený návrh začíná přesně na tom, co by člověk uviděl jinak.
   *
   * Název seznamu se do textu dosazuje jako PROMĚNNÁ `{{ data.list_name }}`, ne
   * jako pevné slovo: stránka může sloužit víc seznamům a zapečený název by
   * u druhého lhal. Kořen `data` je na povrchu stránky povolený.
   */
  function copyFor(field: FormPageField): { title: string; body: string } {
    const list = '{{ data.list_name }}';
    if (field === 'thanks_template_id') {
      const custom = form.success_message[locale] ?? '';
      return {
        title: tc('public.form.thanksTitle'),
        // Vlastní text po odeslání má přednost, protože přesně ten dnes člověk
        // vidí. Kdyby se předvyplnila naše věta, autor by o svoje znění přišel.
        body: custom.trim() === '' ? tc('public.form.thanksBody') : custom,
      };
    }
    if (field === 'confirmed_template_id') {
      return {
        title: tc('public.confirm.doneTitle'),
        body: tc('public.confirm.doneBody', { list }),
      };
    }
    return {
      title: tc('public.confirm.already_usedTitle'),
      body: tc('public.confirm.already_usedBody', { list }),
    };
  }

  /**
   * Trojice voleb je JEDNA volba, takže se ukládá jako celek. „Vlastní stránka"
   * proto nuluje přesměrování a „přesměrovat" nuluje odkaz na stránku; kdyby se
   * ukládalo jen to zvolené, zůstalo by v datech obojí a rozhodla by veřejná
   * trasa, ne uživatel.
   */
  function bodyFor(field: FormPageField, next: PageChoiceValue) {
    const owns = field === 'thanks_template_id';
    if (next.mode === 'default') {
      return { [field]: null, ...(owns ? { redirect_url: null } : {}) };
    }
    if (next.mode === 'page') {
      return { [field]: next.templateId, ...(owns ? { redirect_url: null } : {}) };
    }
    return { [field]: null, redirect_url: next.redirectUrl };
  }

  async function createPage(field: FormPageField, title: string) {
    setCreating(field);
    try {
      const copy = copyFor(field);
      const name = t('newName', { title, owner: form.name }).slice(0, 120);
      const result = await createFormPageAction({
        workspaceId,
        formId: form.id,
        field,
        name,
        document: pageDocument({ name, language: locale, ...copy }),
        // Přesměrování si vlastní jen děkovací stránka, viz hlavička.
        clearRedirect: field === 'thanks_template_id',
      });
      if (result.status === 'error') {
        onFailure(result.detail === '' ? t('createFailed') : result.detail);
        return;
      }
      // Uživatel klikl „vytvořit stránku", takže dalším krokem je navrhování,
      // ne návrat na tuhle obrazovku.
      router.push(editHref(field)(result.id));
    } finally {
      setCreating(null);
    }
  }

  const rows: {
    field: FormPageField;
    name: string;
    title: string;
    hint: string;
    value: PageChoiceValue;
    redirectSupported: boolean;
  }[] = [
    {
      field: 'thanks_template_id',
      name: 'form-page-thanks',
      title: t('thanks'),
      hint: t('thanksHint'),
      value: pageChoiceOf({
        templateId: form.thanks_template_id,
        redirectUrl: form.redirect_url,
      }),
      redirectSupported: true,
    },
    {
      field: 'confirmed_template_id',
      name: 'form-page-confirmed',
      title: t('confirmed'),
      hint: `${t('confirmedHint')} ${t('redirectOnList')}`,
      value: pageChoiceOf({ templateId: form.confirmed_template_id, redirectUrl: null }),
      redirectSupported: false,
    },
    {
      field: 'already_subscribed_template_id',
      name: 'form-page-already',
      title: t('alreadySubscribed'),
      hint: `${t('alreadySubscribedHint')} ${t('redirectOnList')}`,
      value: pageChoiceOf({
        templateId: form.already_subscribed_template_id,
        redirectUrl: null,
      }),
      redirectSupported: false,
    },
  ];

  return (
    <Card gap="gutter" data-testid="form-pages-section">
      <CardTitle>{t('title')}</CardTitle>
      <p className="text-meta text-text-muted">{t('lead')}</p>
      {rows.map((row) => (
        <PageChoice
          key={row.field}
          name={row.name}
          title={row.title}
          hint={row.hint}
          value={row.value}
          options={pages}
          canEdit={canEdit}
          editHref={editHref(row.field)}
          redirectSupported={row.redirectSupported}
          creating={creating === row.field}
          onChange={(next) => void save(bodyFor(row.field, next))}
          onCreate={() => void createPage(row.field, row.title)}
        />
      ))}
    </Card>
  );
}
