import { z } from 'zod';

/**
 * Značka v `contacts.source_ref`. Model kontaktu v části 2 nemá pole pro
 * ukázkovost a nové pole by znamenalo migraci, kterou vlastní P03. Volný
 * textový `source_ref` je proto autoritativní značka a štítek je jen pohodlí
 * pro hromadný výběr v tabulce.
 */
export const DEMO_SOURCE_REF_PREFIX = 'demo-data:';
export const DEMO_SOURCE_REF = `${DEMO_SOURCE_REF_PREFIX}v1`;
export const DEMO_MANIFEST_VERSION = 1;

/** Jméno štítku, přes který jde sada hromadně vybrat a mazat po částech. */
export const DEMO_TAG_NAME = 'Ukázková data';

/**
 * Vzor pro `LIKE`, kterým se ukázkové kontakty poznají **napříč pokoleními sady**.
 *
 * Existuje tady, protože konvenci `source_ref` vlastní tenhle plán, a vynucuje
 * ji P13 v materializaci publika. Kdyby si P13 psal `'demo-data:%'` k sobě,
 * žil by prefix `demo-data:` na dvou místech a při první změně konvence by
 * ochrana **tiše přestala platit**: dotaz by proběhl, nikoho nevyloučil
 * a ukázkové kontakty by se dostaly do publika.
 *
 * Manifest je autoritativní pro rozsah sady, značka je záchytná síť pro
 * kontakty mimo manifest.
 */
export const DEMO_SOURCE_REF_PATTERN = `${DEMO_SOURCE_REF_PREFIX}%`;

export const demoManifestSchema = z.object({
  version: z.literal(DEMO_MANIFEST_VERSION),
  seededAt: z.iso.datetime(),
  contactIds: z.array(z.uuid()),
  listIds: z.array(z.uuid()),
  tagIds: z.array(z.uuid()),
  segmentIds: z.array(z.uuid()),
  templateIds: z.array(z.uuid()),
  campaignIds: z.array(z.uuid()),
});

export type DemoManifest = z.infer<typeof demoManifestSchema>;

export function parseDemoManifest(value: unknown): DemoManifest | null {
  const result = demoManifestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function emptyDemoManifest(seededAt: Date): DemoManifest {
  return {
    version: DEMO_MANIFEST_VERSION,
    seededAt: seededAt.toISOString(),
    contactIds: [],
    listIds: [],
    tagIds: [],
    segmentIds: [],
    templateIds: [],
    campaignIds: [],
  };
}
