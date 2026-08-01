// Podcesta je `document/types`, ne `document`: mapa exports balíčku @mlain/emails
// zní `"./*": "./src/*.ts"`, takže `@mlain/emails/document` by mířilo na
// `src/document.ts`, což je adresář, ne soubor.
import { blockDefaults, DEFAULT_THEME, KNOWN_BLOCK_TYPES } from '@mlain/emails/document/defaults';
import { BLOCK_ID_PATTERN, isBlockId, newBlockId } from '@mlain/emails/document/ids';
import type {
  ColorRef,
  Document,
  InlineNode,
  Padding,
  RichNode,
  RichText,
  Theme,
  VisibilityCondition,
} from '@mlain/emails/document/types';

export type {
  ColorRef,
  Document,
  InlineNode,
  Padding,
  RichNode,
  RichText,
  Theme,
  VisibilityCondition,
};
export { BLOCK_ID_PATTERN, blockDefaults, DEFAULT_THEME, isBlockId, KNOWN_BLOCK_TYPES, newBlockId };

/**
 * Strukturální pohled na blok. Editor záměrně nepracuje s diskriminovaným sjednocením z P08:
 * operace nad stromem jsou na typu bloku nezávislé a znalost typů drží descriptory.
 * Index signature nese neznámé vlastnosti beze ztráty, což vyžaduje kritérium 5 části 3.
 */
export type EditorBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: EditorBlock[];
  visibleWhen?: VisibilityCondition | null;
  [key: string]: unknown;
};

export type EditorDocument = Omit<Document, 'blocks'> & { blocks: EditorBlock[] };

/**
 * Nález v šabloně, jak ho vidí editor.
 *
 * Bydlí tady, tedy u ostatních sdílených typů, a ne u klientské validace, protože
 * ho potřebuje store (úkol 11) dřív, než validace vůbec vznikne (úkol 24).
 * Dvě definice téhož tvaru na dvou místech se vždycky rozejdou; nejpravděpodobněji
 * v tom, jestli je `message` povinné, a projevilo by se to jako prázdný řádek
 * v pruhu nálezů u nálezu z klienta.
 *
 * `message` je nepovinné schválně: klientská validace vrací **kód a parametry**,
 * ne hotovou větu, aby šla přeložit. Hotový text nese jen odpověď serveru
 * u kódu, který editor nezná (kritérium 76 části 6).
 */
export type EditorIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** JSON Pointer na uzel dokumentu, například `/blocks/0/children/1/props/alt`. */
  pointer?: string;
  /** Blok, na který se v pruhu nálezů proklikne. Odvozený z `pointer`. */
  blockId?: string;
  params?: Record<string, string | number>;
  message?: string;
};

export const CONTENT_TYPES = [
  'heading',
  'text',
  'image',
  'button',
  'divider',
  'spacer',
  'html',
  'social',
  'footer',
] as const;

export const CONTAINER_TYPES = ['section', 'columns', 'column', 'repeat'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Seznam známých typů se **nepíše podruhé**. `KNOWN_BLOCK_TYPES` vlastní P08 a je
 * to tentýž seznam, proti kterému validuje JSON Schema. Vlastní kopie by se s ním
 * dřív nebo později rozešla a projevilo by se to jako blok, který editor pokládá
 * za neznámý, přestože ho model zná.
 */
export function isKnownType(type: string): boolean {
  return KNOWN_BLOCK_TYPES.includes(type);
}

/**
 * Nejmenší dokument, který **projde schématem**. Prázdný motiv ani prázdné `props`
 * to nesplní: kořen vyžaduje osm klíčů motivu a `sectionBlock` vyžaduje `props`
 * i `children`, přičemž obojí má `additionalProperties: false`. Výchozí hodnoty
 * proto pocházejí z P08, ne z ruční kopie.
 */
export function emptyDocument(language: string): EditorDocument {
  return {
    schemaVersion: 1,
    meta: { name: '', previewText: '', language },
    theme: DEFAULT_THEME,
    blocks: [
      { id: newBlockId(), type: 'section', props: { ...blockDefaults('section') }, children: [] },
    ],
  } as EditorDocument;
}
