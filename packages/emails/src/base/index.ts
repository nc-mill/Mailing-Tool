/**
 * Veřejná plocha generátoru základní šablony, tedy `@mlain/emails/base`.
 *
 * Barrel existuje kvůli P15: plán importuje `baseSectionSpecSchema`
 * a `buildBaseTemplate` z JEDNÉ adresy a kontraktní test v jeho úkolu 2
 * na tuhle podcestu ukazuje. Bez explicitního klíče v `exports` mapě balíčku
 * by se `@mlain/emails/base` rozřešilo zástupným vzorem na `./src/base.ts`,
 * tedy na soubor, který neexistuje.
 *
 * Není to barrel přes celý balíček. Zbytek `packages/emails` se dál importuje
 * podcestami (`@mlain/emails/compile/compile`, `@mlain/emails/document/types`),
 * protože jedna velká vstupní plocha by do každého konzumenta vtáhla React
 * i emitter, i když chce jen typ.
 */
export { brandToTheme, type BrandInput } from './brand';
export {
  buildBaseTemplate,
  type BaseTemplateParams,
  type BaseTemplateVariant,
  type BuildOptions,
} from './build';
export { plainToRichText } from './rich';
export {
  articleSectionSchema,
  baseSectionSpecSchema,
  BASE_SECTION_KINDS,
  bulletsSectionSchema,
  ctaSectionSchema,
  featureSectionSchema,
  heroSectionSchema,
  keyValueSectionSchema,
  quoteSectionSchema,
  spacerSectionSchema,
  type BaseSectionSpec,
} from './sections';
