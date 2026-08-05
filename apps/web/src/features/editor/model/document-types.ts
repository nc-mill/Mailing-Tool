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
  /**
   * Nález ze SERVERU, který platí o starší verzi dokumentu.
   *
   * Serverová validace umí navíc předodesílací kontrolu (kódy `precheck_*`),
   * jenže běží jednorázově, kdežto dokument se pod ní mění. Po úpravě se takový
   * nález NEZAHAZUJE, protože pak by chyba mizela pokaždé, když uživatel napíše
   * písmeno, ale ani se netváří jako čerstvý: může mluvit o obsahu, který mezitím
   * někdo opravil. Příznak si nese kvůli tomu, aby to pruh mohl říct nahlas.
   *
   * Zmizí sám, jakmile doběhne další serverová validace, tedy po uložení.
   */
  stale?: boolean;
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
export function emptyDocument(language: string, name = 'Nová šablona'): EditorDocument {
  /*
   * `meta.name` NESMÍ být prázdný řetězec.
   *
   * Dřívější znění tu mělo `name: ''` a komentář nad funkcí přitom slibuje
   * „nejmenší dokument, který projde schématem". Neprošel: `document.v1.schema.json`
   * má u `meta.name` `minLength: 1`, takže server odpověděl 422 a šablonu
   * nešlo z rozhraní založit vůbec. Doslovně z instalace:
   *
   *   POST /api/v1/templates → 422 template_document_invalid
   *   findings: [{ code: 'schema_minLength', path: 'meta.name',
   *                params: { message: '/meta/name must NOT have fewer than 1 characters' } }]
   *
   * Uživatel viděl jen „Šablonu se nepodařilo vytvořit." Výchozí jméno se
   * proto bere z volajícího, aby `meta.name` odpovídalo názvu šablony.
   *
   * PATIČKA JE POVINNÁ, a to hned od založení.
   *
   * Po opravě `meta.name` padal dokument dál, na doménovém pravidle S4:
   *
   *   POST /api/v1/templates → 422 template_document_invalid
   *   findings: [{ code: 'content_missing_unsubscribe' }]
   *
   * Odhlašovací odkaz je podmínka platnosti dokumentu, ne kontrola před
   * odesláním, takže se nedá odložit „na později": šablona bez něj by se dala
   * navrhnout, uložit i zavřít a teprve odesílání by řeklo, že je nepoužitelná.
   *
   * Patička je DÍTĚ SEKCE, ne blok nejvyšší úrovně. Nahoře smí být jen sekce;
   * pokus vložit `footer` vedle ní skončí na `/blocks/1/type must be equal to
   * constant`. Stejné uspořádání má i každá ukázková šablona, viz
   * `packages/core/src/demo/dataset.ts`.
   */
  return {
    schemaVersion: 1,
    meta: { name, previewText: '', language },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: newBlockId(),
        type: 'section',
        props: { ...blockDefaults('section') },
        children: [{ id: newBlockId(), type: 'footer', props: { ...blockDefaults('footer') } }],
      },
    ],
  } as EditorDocument;
}
