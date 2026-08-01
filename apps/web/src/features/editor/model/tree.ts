import { CONTENT_TYPES, type EditorBlock, type EditorDocument } from './document-types';

export type Path = number[];

export type FlatItem = {
  block: EditorBlock;
  path: Path;
  level: number; // 1 = sekce
  index: number; // pozice mezi sourozenci, od nuly
  siblings: number; // počet sourozenců včetně sebe
};

const CONTENT = new Set<string>(CONTENT_TYPES);

const ALLOWED: Record<string, (child: string) => boolean> = {
  $root: (c) => c === 'section',
  section: (c) => c === 'columns' || c === 'repeat' || CONTENT.has(c),
  columns: (c) => c === 'column',
  column: (c) => CONTENT.has(c),
  repeat: (c) => CONTENT.has(c),
};

export function canContain(parentType: string, childType: string): boolean {
  const rule = ALLOWED[parentType];
  return rule ? rule(childType) : false;
}

export function childrenOf(doc: EditorDocument, path: Path): EditorBlock[] {
  if (path.length === 0) return doc.blocks;
  return blockAt(doc, path)?.children ?? [];
}

export function blockAt(doc: EditorDocument, path: Path): EditorBlock | undefined {
  let list: EditorBlock[] | undefined = doc.blocks;
  let block: EditorBlock | undefined;
  for (const index of path) {
    block = list?.[index];
    if (!block) return undefined;
    list = block.children;
  }
  return block;
}

export function typeAt(doc: EditorDocument, path: Path): string {
  if (path.length === 0) return '$root';
  return blockAt(doc, path)?.type ?? '$unknown';
}

export function findBlock(
  doc: EditorDocument,
  id: string,
): { block: EditorBlock; path: Path } | undefined {
  const walk = (
    list: EditorBlock[],
    prefix: Path,
  ): { block: EditorBlock; path: Path } | undefined => {
    for (let i = 0; i < list.length; i += 1) {
      const block = list[i];
      if (!block) continue;
      const path = [...prefix, i];
      if (block.id === id) return { block, path };
      const found = block.children ? walk(block.children, path) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return walk(doc.blocks, []);
}

export function flatten(doc: EditorDocument): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (list: EditorBlock[], prefix: Path, level: number) => {
    list.forEach((block, index) => {
      const path = [...prefix, index];
      out.push({ block, path, level, index, siblings: list.length });
      if (block.children) walk(block.children, path, level + 1);
    });
  };
  walk(doc.blocks, [], 1);
  return out;
}
