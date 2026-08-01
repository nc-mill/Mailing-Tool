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

export const PALETTE: Array<{ label: I18nKey; entries: PaletteEntry[] }> = [
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
