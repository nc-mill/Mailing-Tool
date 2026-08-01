import { z } from 'zod';

/**
 * RUNTIME SCHÉMA SEKCÍ ZÁKLADNÍ ŠABLONY.
 *
 * Existuje kvůli nálezu N62: P15 staví strukturovaný výstup jazykového modelu
 * na `baseSectionSpecSchema.safeParse(...)` a `z.array(baseSectionSpecSchema)`,
 * a samotný TypeScriptový typ `BaseSectionSpec` v runtime neexistuje. Druhý
 * zdroj pravdy se nezakládá: typ se odvozuje ze schématu přes `z.infer`,
 * takže se schéma a typ nemůžou rozejít.
 *
 * Schéma je zároveň hranicí důvěry. Sekce chodí z jazykového modelu, tedy
 * z místa, kde vstup není pod naší kontrolou, a generátor je vkládá do
 * dokumentu jako PROSTÝ TEXT (`plainToRichText`). Kdyby v poli byl kus HTML,
 * emitter by ho vypsal jako viditelné znaky uprostřed odstavce, nebo, hůř,
 * by se dostal do bloku, který sanitizaci nedělá. Proto se textová pole
 * kontrolují na značky a odkazy se omezují na http a https.
 */

/** Značka nebo její zbytek. Uzavírací i samouzavírací tvar, s libovolnými atributy. */
const HTML_TAG = /<\s*\/?\s*[a-zA-Z][^>]*>/;
/** Entita, tedy HTML propašované přes `&lt;script&gt;`. */
const HTML_ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/;

/**
 * Prostý text. Nesanitizuje, odmítá: hodnota, která má být textem a obsahuje
 * značku, je skoro vždy chyba na straně generátoru, a tichá oprava by ji
 * schovala až do hotové šablony.
 */
function plainText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !HTML_TAG.test(value), {
      error: 'base_section_html_not_allowed',
    })
    .refine((value) => !HTML_ENTITY.test(value), {
      error: 'base_section_html_entity_not_allowed',
    });
}

/**
 * Odkaz. Jen absolutní http a https: `javascript:` a `data:` jsou v mailu
 * cesta k útoku a relativní URL v mailu nedává smysl, protože neexistuje
 * stránka, vůči které by se rozřešila.
 */
const href = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === 'http:' || url.protocol === 'https:';
    },
    { error: 'base_section_href_not_absolute_http' },
  );

/** Identifikátor assetu. Generátor ho smí uvést jen tehdy, když asset opravdu existuje. */
const assetId = z.uuid();

const cta = z.object({ label: plainText(80), href });

export const heroSectionSchema = z.object({
  kind: z.literal('hero'),
  headline: plainText(200),
  subhead: plainText(400).optional(),
  imageAssetId: assetId.optional(),
  cta: cta.optional(),
});

export const articleSectionSchema = z.object({
  kind: z.literal('article'),
  heading: plainText(200),
  body: plainText(5000),
  imageAssetId: assetId.optional(),
  link: z.object({ label: plainText(80), href }).optional(),
});

export const featureSectionSchema = z.object({
  kind: z.literal('feature'),
  imageAssetId: assetId.optional(),
  headline: plainText(200),
  body: plainText(5000),
  cta,
});

export const bulletsSectionSchema = z.object({
  kind: z.literal('bullets'),
  heading: plainText(200).optional(),
  items: z.array(plainText(400)).min(1).max(20),
});

export const keyValueSectionSchema = z.object({
  kind: z.literal('keyValue'),
  rows: z
    .array(z.object({ label: plainText(120), value: plainText(400) }))
    .min(1)
    .max(20),
});

export const quoteSectionSchema = z.object({
  kind: z.literal('quote'),
  text: plainText(1000),
  author: plainText(120).optional(),
});

export const ctaSectionSchema = z.object({
  kind: z.literal('cta'),
  label: plainText(80),
  href,
  note: plainText(400).optional(),
});

export const spacerSectionSchema = z.object({ kind: z.literal('spacer') });

/**
 * Rozlišená unie podle `kind`. Rozlišená schválně: `z.union` by u neznámého
 * druhu vydal chyby ze všech osmi variant naráz a jazykový model by z toho
 * neměl jak poznat, co má opravit.
 */
export const baseSectionSpecSchema = z.discriminatedUnion('kind', [
  heroSectionSchema,
  articleSectionSchema,
  featureSectionSchema,
  bulletsSectionSchema,
  keyValueSectionSchema,
  quoteSectionSchema,
  ctaSectionSchema,
  spacerSectionSchema,
]);

/**
 * Typ se ODVOZUJE ze schématu, nepíše se podruhé ručně. Nález N62 na to
 * upozorňuje výslovně: dvě samostatné definice téhož tvaru se rozejdou
 * a rozchod se pozná až na nevalidní šabloně u zákazníka.
 */
export type BaseSectionSpec = z.infer<typeof baseSectionSpecSchema>;

/** Druh sekce jako hodnota, pro nabídky v UI i pro výčet v promptu. */
export const BASE_SECTION_KINDS = [
  'hero',
  'article',
  'feature',
  'bullets',
  'keyValue',
  'quote',
  'cta',
  'spacer',
] as const satisfies ReadonlyArray<BaseSectionSpec['kind']>;
