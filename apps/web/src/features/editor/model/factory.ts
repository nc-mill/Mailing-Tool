import { BLOCK_DESCRIPTORS, type PaletteEntry } from '../descriptors/registry';
import type { EditorBlock } from './document-types';
import { newBlockId } from './document-types';

const COLUMN_COUNT: Record<string, number> = {
  '1-1': 2,
  '1-2': 2,
  '2-1': 2,
  '1-1-1': 3,
  '2-1-1': 3,
  '1-1-2': 3,
};

export function createBlock(
  type: string,
  preset: Record<string, unknown> = {},
  gen: () => string = newBlockId,
): EditorBlock {
  const descriptor = BLOCK_DESCRIPTORS[type];
  if (!descriptor) throw new Error(`unknown block type: ${type}`);
  const block: EditorBlock = {
    id: gen(),
    type,
    props: structuredClone({ ...descriptor.defaults, ...preset }),
  };
  if (type === 'section' || type === 'column') block.children = [];
  if (type === 'columns') {
    const count = COLUMN_COUNT[String(block.props.layout)] ?? 2;
    block.children = Array.from({ length: count }, () => createBlock('column', {}, gen));
  }
  return block;
}

export function createFromPaletteEntry(
  entry: PaletteEntry,
  gen: () => string = newBlockId,
): EditorBlock {
  return createBlock(entry.type, entry.preset ?? {}, gen);
}
