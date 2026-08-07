import { BUTTON_DESCRIPTOR } from './button';
import { COLUMN_DESCRIPTOR } from './column';
import { COLUMNS_DESCRIPTOR } from './columns';
import { DIVIDER_DESCRIPTOR } from './divider';
import { FOOTER_DESCRIPTOR } from './footer';
import { HEADING_DESCRIPTOR } from './heading';
import { HTML_DESCRIPTOR } from './html';
import { IMAGE_DESCRIPTOR } from './image';
import { SECTION_DESCRIPTOR } from './section';
import { SOCIAL_DESCRIPTOR } from './social';
import { SPACER_DESCRIPTOR } from './spacer';
import { TEXT_DESCRIPTOR } from './text';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { BlockDescriptor, EditorIconName, I18nKey } from './types';

export const BLOCK_DESCRIPTORS: Record<string, BlockDescriptor> = {
  section: SECTION_DESCRIPTOR,
  columns: COLUMNS_DESCRIPTOR,
  column: COLUMN_DESCRIPTOR,
  heading: HEADING_DESCRIPTOR,
  text: TEXT_DESCRIPTOR,
  image: IMAGE_DESCRIPTOR,
  button: BUTTON_DESCRIPTOR,
  divider: DIVIDER_DESCRIPTOR,
  spacer: SPACER_DESCRIPTOR,
  social: SOCIAL_DESCRIPTOR,
  footer: FOOTER_DESCRIPTOR,
  html: HTML_DESCRIPTOR,
};

/**
 * Zamčený placeholder pro `repeat` a pro neznámý typ bloku. Nemá vlastnosti, takže se v panelu
 * nedá nic změnit, a dokument se uloží bajtově shodný (kritéria 5 a 8d části 3).
 */
export const LOCKED_DESCRIPTOR: BlockDescriptor = {
  type: '$unknown',
  label: 'block.unknown',
  icon: 'unknown',
  inPalette: false,
  groups: [],
  defaults: {},
};

export function descriptorFor(type: string): BlockDescriptor {
  return BLOCK_DESCRIPTORS[type] ?? { ...LOCKED_DESCRIPTOR, type };
}

export type PaletteEntry = {
  id: string;
  type: string;
  label: I18nKey;
  icon: EditorIconName;
  preset?: Record<string, unknown>;
};

export type PaletteGroup = { label: I18nKey; entries: PaletteEntry[] };

export const PALETTE: Array<PaletteGroup> = [
  {
    label: 'palette.group.content',
    entries: [
      { id: 'heading', type: 'heading', label: 'block.heading', icon: 'heading' },
      { id: 'text', type: 'text', label: 'block.text', icon: 'text' },
      { id: 'image', type: 'image', label: 'block.image', icon: 'image' },
      { id: 'button', type: 'button', label: 'block.button', icon: 'button' },
      { id: 'divider', type: 'divider', label: 'block.divider', icon: 'divider' },
      { id: 'spacer', type: 'spacer', label: 'block.spacer', icon: 'spacer' },
      { id: 'social', type: 'social', label: 'block.social', icon: 'social' },
      { id: 'html', type: 'html', label: 'block.html', icon: 'code' },
      { id: 'footer', type: 'footer', label: 'block.footer', icon: 'footer' },
    ],
  },
  {
    label: 'palette.group.layout',
    entries: [
      { id: 'section', type: 'section', label: 'block.section', icon: 'section' },
      {
        id: 'columns-2',
        type: 'columns',
        label: 'block.columns2',
        icon: 'columns2',
        preset: { layout: '1-1' },
      },
      {
        id: 'columns-3',
        type: 'columns',
        label: 'block.columns3',
        icon: 'columns3',
        preset: { layout: '1-1-1' },
      },
    ],
  },
];

/**
 * Bloky, které se v paletě VEŘEJNÉ STRÁNKY nenabídnou.
 *
 * `footer` je patička s odhlašovacím odkazem. Na stránce, na kterou se chodí
 * z formuláře nebo z potvrzovacího e-mailu, nemá koho odhlašovat a odhlášení
 * má vlastní stránku, takže by autora jen sváděla vyrobit odkaz, který nikam
 * nevede.
 *
 * `html` je blok syrového HTML a je to BEZPEČNOSTNÍ ROZHODNUTÍ (plán, oddíl 4.4).
 * V kampani je HTML povolené, protože e-mail čte příjemce ve svém klientu, který
 * skripty stejně nespustí. Veřejná stránka ale běží NA NAŠÍ DOMÉNĚ, takže
 * vložený obsah v ní může předstírat cokoli: přihlašovací pole, cizí značku,
 * jinou cenu. Přísná politika obsahu zastaví skript, ale ne podvodný text ani
 * `javascript:` v odkazu. Autorem přitom nemusí být vlastník projektu, stačí
 * člen s právem upravovat formuláře. Je to totéž rozhodnutí, jaké padlo
 * u textu souhlasu u zaškrtávacího políčka.
 */
const HIDDEN_ON_PAGE: ReadonlySet<string> = new Set(['footer', 'html']);

/**
 * Paleta pro daný validační profil.
 *
 * ZUŽUJE SE JEN PROFIL `page`, ostatní dostanou `PALETTE` beze změny, a to
 * i identicky (`===`), aby se kampaň nemohla omylem svézt s úpravou stránky.
 * Filtruje se TADY, na jednom místě, protože paletu čtou dvě obrazovky: panel
 * bloků vlevo a nabídka „přidej blok sem" mezi bloky. Druhá kopie seznamu by
 * znamenala, že se blok nedá vzít z panelu, ale dá se vložit z nabídky.
 */
export function paletteFor(profile: ValidationProfile): Array<PaletteGroup> {
  if (profile !== 'page') return PALETTE;
  return PALETTE.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => !HIDDEN_ON_PAGE.has(entry.type)),
  })).filter((group) => group.entries.length > 0);
}
