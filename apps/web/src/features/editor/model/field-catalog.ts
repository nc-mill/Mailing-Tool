/**
 * Převody mezi cestou v katalogu (`first_name`, `attr.city`) a merge cestou,
 * která se píše do šablony (`contact.first_name`).
 *
 * **Nebydlí v kontraktech.** `@mlain/contracts/fields` neexistuje: P02 rozhodnutím
 * R2 katalog polí i převody cest vůbec nedodává, protože stojí na modelu kontaktu.
 * Napsané jsou v `packages/emails/src/paths.ts`, tedy u P08, který je potřebuje
 * pro renderer. Editor je z téhož místa jen čte, aby nevznikla druhá verze převodu.
 */
export { toCatalogPath, toLiquidRoots, toMergePath } from '@mlain/emails/paths';

/**
 * Typy katalogu vlastní P07 a berou se z veřejné plochy domény, ne z hluboké
 * podcesty. Vlastní kopie tvaru by se s ní časem rozešla a projevilo by se to
 * jako pole, které editor nenabízí, přestože v projektu existuje.
 *
 * Import a reexport jsou dva řádky schválně: `export type { X } from` typ
 * reexportuje, ale nezavede ho do místního rozsahu, takže by se o pár řádků níž
 * nedal použít v `Record<FieldCatalogType, …>`.
 *
 * Import je `import type`, takže z něj po překladu nezbude žádný běhový import.
 * Doména `@mlain/core/contacts` sahá na databázi a do prohlížeče nesmí.
 */
import type { FieldCatalog, FieldCatalogEntry, FieldCatalogType } from '@mlain/core/contacts';

export type { FieldCatalog, FieldCatalogEntry, FieldCatalogType };

/** `LocalizedText` P07 z veřejné plochy nevystavuje, je to jen tvar popisku. */
export type LocalizedText = Record<string, string> & { en: string };

export type VisibilityOperator = 'present' | 'blank' | 'true' | 'false';

/** Tabulka z části 3, 3.8.2. Operátor mimo typ pole je chyba content_condition_operator_invalid. */
export const OPERATORS_BY_TYPE: Record<FieldCatalogType, VisibilityOperator[]> = {
  string: ['present', 'blank'],
  number: ['present', 'blank'],
  date: ['present', 'blank'],
  datetime: ['present', 'blank'],
  list: ['present', 'blank'],
  boolean: ['true', 'false'],
};

/**
 * Výběr popisku: jazyk uživatele, pak základní jazyk bez oblasti, pak en (část 3, 3.1.9).
 *
 * `?? ''` u rozdělení jazykového tagu je kvůli `noUncheckedIndexedAccess`:
 * `split('-')[0]` má typ `string | undefined` a indexovat objekt hodnotou
 * `undefined` se nezkompiluje.
 */
export function pickLabel(label: LocalizedText, locale: string): string {
  return label[locale] ?? label[locale.split('-')[0] ?? ''] ?? label.en;
}

export function usableFields(catalog: FieldCatalog): FieldCatalogEntry[] {
  return catalog.fields.filter((field) => !field.deleted);
}
