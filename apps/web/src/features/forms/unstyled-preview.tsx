'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
/*
 * CÍLENÝ IMPORT, ne barrel `@mlain/core/contacts`. Tohle je KLIENTSKÁ komponenta
 * a barrel domény táhne přes `subscription-emails` a `workspace-service` až na
 * hashování hesel (`@node-rs/argon2`), které v prohlížeči přeložit nejde. Build
 * pak spadne na „Can't resolve @node-rs/argon2-wasm32-wasi" a stopa importu vede
 * přes pět souborů, takže na první pohled vypadá jako vada cizí knihovny.
 * Samotný `consent-markup` je čistá funkce bez jediné závislosti.
 */
import { consentTextToHtml } from '@mlain/core/contacts/forms/consent-markup';
import type { FormFieldView } from './types';

/**
 * Pole tak, jak ho náhled potřebuje. Je to průnik `BuilderField` z editoru polí
 * a `FormFieldView` z API, aby obě obrazovky mohly krmit TENTÝŽ náhled.
 */
export type PreviewField = {
  key: string;
  label: string;
  required: boolean;
  type: string;
  options?: { value: string; label: string }[];
};

function keyOf(field: FormFieldView): string {
  return typeof field.target === 'string' ? field.target : `attr_${field.target.attribute}`;
}

/** Tvar z API na tvar pro náhled. Popisky jsou vícejazyčné, náhled ukazuje jeden jazyk. */
export function toPreviewField(field: FormFieldView, locale: string): PreviewField {
  return {
    key: keyOf(field),
    label: field.label[locale] ?? field.label['en'] ?? '',
    required: field.required,
    type: field.type,
    ...(field.options === undefined
      ? {}
      : {
          options: field.options.map((option) => ({
            value: option.value,
            label: option.label[locale] ?? option.label['en'] ?? option.value,
          })),
        }),
  };
}

/**
 * Živý náhled formuláře BEZ JEDINÉHO NAŠEHO PRAVIDLA STYLU.
 *
 * BĚŽÍ V RÁMEČKU (`iframe`) SE SVÝM VLASTNÍM DOKUMENTEM, ne přímo na obrazovce.
 * Zní to jako komplikace, ale bez toho náhled LŽE: naše aplikace má reset stylů,
 * takže holý `input` v ní nemá rámeček ani odsazení a formulář vypadal jako
 * seznam popisků bez políček. Přesně opačně, než jak vypadá na cizím webu, kde
 * platí výchozí styly prohlížeče.
 *
 * Uvnitř rámečku není ANI JEDNO naše pravidlo, takže je vidět to, co uvidí
 * návštěvník stránky, která si formulář zatím nenastylovala. Není to totéž co
 * shadow DOM ve vkládaném formuláři, který je zakázaný: ten by izoloval formulář
 * na CIZÍM webu a znemožnil jeho stylování. Tady jde o náhled na naší obrazovce.
 *
 * JE TO JEDINÝ NÁHLED VKLÁDANÉHO FORMULÁŘE V CELÉM PRODUKTU a je schválně sdílený
 * mezi editorem polí a obrazovkou s kódem k vložení. Dvě kopie by se rozešly a jedna
 * z nich by uživateli slibovala vzhled, který nedostane. Hostovaná stránka `/f/{ref}`
 * je něco jiného: ta naše styly má a odkaz na ni proto NENÍ náhled vloženého formuláře.
 */
export function UnstyledFormPreview({
  items,
  consentText,
}: {
  items: PreviewField[];
  /** Text souhlasu. Prázdný řetězec nebo `null` znamená, že formulář souhlas nemá. */
  consentText?: string | null;
}) {
  const t = useTranslations('forms.fields');

  const html = useMemo(() => {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const controls = items
      .map((item) => {
        const id = `p-${escape(item.key)}`;
        const required = item.required ? ' required' : '';
        const control =
          item.type === 'textarea'
            ? `<textarea id="${id}"${required}></textarea>`
            : item.type === 'select'
              ? `<select id="${id}"${required}>${(item.options ?? [])
                  .map((option) => `<option>${escape(option.label)}</option>`)
                  .join('')}</select>`
              : `<input id="${id}" type="${escape(
                  item.type === 'datetime' ? 'datetime-local' : item.type,
                )}"${required}>`;
        return `<div class="ml-field"><label class="ml-label" for="${id}">${escape(
          item.label,
        )}</label> ${control}</div>`;
      })
      .join('');

    // Souhlas patří do náhledu ze stejného důvodu jako pole: vkládaný formulář ho
    // vykreslí, takže náhled bez něj by ukazoval kratší formulář, než jaký vznikne.
    //
    // Text jde přes `consentTextToHtml`, ne přes `escape`. Je to TÁŽ funkce, jakou
    // používá veřejná stránka, takže odkaz na podmínky vypadá v náhledu stejně jako
    // naostro. S prostým escapováním se tu ukazoval zápis odkazu jako holé znaky
    // a autor si myslel, že mu odkaz nefunguje.
    const consent =
      consentText === undefined || consentText === null || consentText === ''
        ? ''
        : `<div class="ml-consent"><input id="p-consent" type="checkbox"> <label for="p-consent">${consentTextToHtml(
            consentText,
          )}</label></div>`;

    return `<!doctype html><html><body style="margin:8px"><form class="ml-form">${controls}${consent}<button class="ml-button" type="submit">${escape(
      t('previewSubmit'),
    )}</button></form></body></html>`;
  }, [items, consentText, t]);

  return (
    <div className="flex flex-col gap-[var(--spacing-stack)]">
      <div className="flex flex-col gap-[var(--spacing-hairline)]">
        <h3 className="meta-caps text-text-muted">{t('preview')}</h3>
        <p className="text-meta text-text-muted">{t('previewHint')}</p>
      </div>
      {/*
       * `bg-white` je jediná barva na téhle obrazovce, která NENÍ token, a je to
       * schválně: rámeček nepředstavuje plochu naší aplikace, ale cizí stránku
       * s výchozími styly prohlížeče. Papírová barva ani tmavý režim by tady
       * lhaly, protože web, kam si formulář někdo vloží, naše motivy nemá.
       */}
      <iframe
        title={t('preview')}
        data-testid="field-preview"
        srcDoc={html}
        className="h-64 w-full rounded-[var(--radius-control)] border border-border bg-white"
        sandbox=""
      />
    </div>
  );
}
