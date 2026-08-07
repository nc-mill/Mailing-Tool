'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * JMÉNO TYPU POLE, JAK BY HO ŘEKL ČLOVĚK.
 *
 * Nález z ostrého provozu: v nabídce typů stálo `boolean`, `long_text` a `url`,
 * tedy jména z DDL. Uživatel u `boolean` nevěděl, co do pole vlastně půjde
 * zadat, a je to přesně to jediné, co o typu vědět potřebuje: buď ano, nebo ne.
 *
 * Typy jsou na TŘECH slovnících naráz a bez převodu by polovina zůstala
 * nepřeložená:
 *
 * 1. Typ vlastního pole kontaktu (`ck_contact_fields__type`): `text`,
 *    `long_text`, `number`, `boolean`, `date`, `datetime`, `enum`,
 *    `multi_enum`, `url`, `email`, `phone`. Tohle je zdroj pravdy.
 * 2. Značka vstupu ve formuláři (`INPUT_TYPE_FOR` ve stavěči polí): tentýž typ,
 *    ale přeložený do jazyka HTML, tedy `checkbox` místo `boolean` a `textarea`
 *    místo `long_text`. Uložená definice formuláře nese TUHLE podobu, takže
 *    obrazovka polí formuláře dostane `checkbox` a musí z něj vyrobit „Ano/ne".
 * 3. Typ v katalogu editoru (`FieldCatalogType`): `string`, `number`, `date`,
 *    `datetime`, `list`, `boolean`. Hrubší dělení kvůli operátorům viditelnosti.
 *
 * Převod je jednosměrný a ztrátový schválně: z `checkbox` se pozná `boolean`,
 * z `textarea` `long_text`. Zpátky se nic nepřevádí, tady se jen pojmenovává.
 */
const ALIASES: Record<string, string> = {
  checkbox: 'boolean',
  textarea: 'long_text',
  select: 'enum',
  multiselect: 'multi_enum',
  tel: 'phone',
  'datetime-local': 'datetime',
  string: 'text',
  list: 'multi_enum',
};

/** Klíče, které v `common.fieldType` opravdu jsou. Cokoli jiného spadne na `unknown`. */
const KNOWN = new Set([
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'multi_enum',
  'url',
  'email',
  'phone',
]);

/** Kanonický klíč typu, nebo `null`, když typ neznáme. */
export function canonicalFieldType(type: string): string | null {
  const key = ALIASES[type] ?? type;
  return KNOWN.has(key) ? key : null;
}

/**
 * Popisek typu pole. Neznámý typ se NESCHOVÁ: vypíše se „Neznámý typ (…)"
 * i se syrovou hodnotou, protože mlčky prázdná buňka by vypadala jako vada
 * načítání, kdežto tohle je zpráva „přibyl typ, na který rozhraní nestačí".
 */
export function useFieldTypeLabel(): (type: string) => string {
  const t = useTranslations('common.fieldType');
  return useCallback(
    (type: string) => {
      const key = canonicalFieldType(type);
      return key === null ? t('unknown', { type }) : t(key);
    },
    [t],
  );
}

/** Jedna věta o tom, co se do pole zadává. U neznámého typu není co říct. */
export function useFieldTypeHint(): (type: string) => string | null {
  const t = useTranslations('common.fieldTypeHint');
  return useCallback(
    (type: string) => {
      const key = canonicalFieldType(type);
      return key === null ? null : t(key);
    },
    [t],
  );
}
