'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * JMÉNO PEVNÉHO POLE KONTAKTU, JAK BY HO ŘEKL ČLOVĚK.
 *
 * Nález z ostrého provozu, tentýž jako u typů polí: ve stavěči polí formuláře
 * se pevná pole nabízela syrovými jmény z API (`first_name`, `full_name`),
 * v mono písmu a bez překladu. Horší než ošklivá nabídka bylo, co z ní vyšlo:
 * vybrané pole si to jméno vzalo i jako POPISEK a formulář ho pak ukazoval
 * návštěvníkovi na veřejné stránce.
 *
 * Popisky se NEVYRÁBĚJÍ znovu. Berou se z katalogu `editor.field.*`, kde už
 * bydlí kvůli paletce personalizace v editoru (`richtext/field-labels.tsx`);
 * druhá sada by se s tou první rozešla přesně v okamžiku, kdy někdo jednu z nich
 * opraví. Přibyl v něm jediný klíč, `fullName`: celé jméno není sloupec kontaktu
 * (rozděluje se na jméno a příjmení), takže značku v editoru nemá, ale zapsat
 * do něj formulář i import umí.
 *
 * Klíč se NEODVOZUJE převodem snake_case na camelCase. Výčet je uzavřený a
 * krátký, kdežto odvození by u neznámé hodnoty vyrobilo klíč, který v katalogu
 * není, a `next-intl` by na něj spadl až u uživatele.
 *
 * ZNĚNÍ POPISKŮ SE SROVNALO S OSTATNÍMI OBRAZOVKAMI, ne vymyslelo znovu.
 * `contacts.locale` se v mapování importu i ve stavěči segmentů jmenuje „Jazyk
 * komunikace", kdežto katalog editoru měl „Jazyk kontaktu". Dvě jména pro jedno
 * pole jsou horší než anglický klíč na obou místech, takže se srovnal katalog
 * editoru (byl v menšině, jedna obrazovka proti dvěma). Zbytek už seděl:
 * „E-mail", „Jméno", „Příjmení", „Celé jméno".
 */
const TARGET_LABEL_KEY: Record<string, string> = {
  email: 'field.email',
  first_name: 'field.firstName',
  last_name: 'field.lastName',
  full_name: 'field.fullName',
  locale: 'field.locale',
  title_prefix: 'field.titlePrefix',
  title_suffix: 'field.titleSuffix',
  gender: 'field.gender',
};

/**
 * Popisek pevného pole kontaktu. Neznámé jméno se vrátí, jak přišlo: syrový
 * název je pořád srozumitelnější než prázdno a je z něj poznat, že rozhraní
 * o poli neví.
 */
export function useContactTargetLabel(): (target: string) => string {
  const t = useTranslations('editor');
  return useCallback(
    (target: string) => {
      const key = TARGET_LABEL_KEY[target];
      return key === undefined ? target : t(key);
    },
    [t],
  );
}
