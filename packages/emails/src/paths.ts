import type { LiquidRoots } from '@mlain/contracts/liquid';
import type { FieldCatalog } from './external/field-catalog';
import type { RenderSchema } from './compile/types';

/**
 * Cesta v šabloně na cestu v katalogu polí. Katalog vlastní P07 a jeho
 * `FieldCatalogEntry.path` je BEZ prefixu `contact.` (požadavek R9), kdežto
 * v šabloně se píše `{{ contact.attr.city }}`.
 */
export function toCatalogPath(path: string): string {
  return path.startsWith('contact.') ? path.slice('contact.'.length) : path;
}

/** Opačný směr: cesta v katalogu na merge tag, který se píše do šablony. */
export function toMergePath(catalogPath: string): string {
  return `contact.${catalogPath}`;
}

/**
 * Zúžení bohatého katalogu na úzký tvar, který chce Liquid validátor.
 * Jsou to dva různé typy: `FieldCatalog` má cesty, typy a popisky a vlastní ho
 * P07, `LiquidRoots` je jen seznam povolených kořenů a vlastní ho kontrakt.
 * Dřív se obojí jmenovalo `FieldCatalog` (rozhodnutí R2), takže tenhle převod
 * je jediné místo, kde se ta dvě jména potkávají, a nikdy se nepřetypovává.
 */
export function toLiquidRoots(catalog: FieldCatalog): LiquidRoots {
  const contactFirstClass: string[] = [];
  const contactAttrKeys: string[] = [];
  for (const field of catalog.fields) {
    if (field.path.startsWith('attr.')) contactAttrKeys.push(field.path.slice('attr.'.length));
    else contactFirstClass.push(field.path);
  }
  return { contactFirstClass, contactAttrKeys };
}

/**
 * Zúžení `RenderSchema` na tvar, který chce `prepareRenderData` z kontraktů.
 * Kontrakt používá pro svůj úzký tvar bohužel TOTÉŽ jméno `RenderSchema`,
 * takže bez tohohle převodu by se přiřazení buď nezkompilovalo, nebo by ho
 * někdo protlačil přetypováním a ztratil kontrolu úplně.
 */
export function toPreparedSchema(schema: RenderSchema): {
  fields: readonly string[];
  presence: readonly string[];
} {
  return { fields: schema.fields.map((field) => field.path), presence: schema.presence };
}
