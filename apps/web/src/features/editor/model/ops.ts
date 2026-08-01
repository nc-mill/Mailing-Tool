import type { EditorBlock, EditorDocument, VisibilityCondition } from './document-types';
import { newBlockId } from './document-types';
import { blockAt, canContain, childrenOf, findBlock, type Path, typeAt } from './tree';

export class EditorOpError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'EditorOpError';
  }
}

export type MoveTarget = { parent: Path; index: number };

function replaceChildren(
  doc: EditorDocument,
  path: Path,
  update: (list: EditorBlock[]) => EditorBlock[],
): EditorDocument {
  if (path.length === 0) return { ...doc, blocks: update(doc.blocks) };
  const [head, ...rest] = path;
  const blocks = doc.blocks.map((block, index) => {
    if (index !== head) return block;
    return replaceIn(block, rest, update);
  });
  return { ...doc, blocks };
}

function replaceIn(
  block: EditorBlock,
  path: Path,
  update: (list: EditorBlock[]) => EditorBlock[],
): EditorBlock {
  if (path.length === 0) return { ...block, children: update(block.children ?? []) };
  const [head, ...rest] = path;
  const children = (block.children ?? []).map((child, index) =>
    index === head ? replaceIn(child, rest, update) : child,
  );
  return { ...block, children };
}

export function insertBlock(
  doc: EditorDocument,
  parent: Path,
  index: number,
  block: EditorBlock,
): EditorDocument {
  const parentType = typeAt(doc, parent);
  if (!canContain(parentType, block.type)) {
    throw new EditorOpError(
      parentType === 'column' && block.type === 'columns'
        ? 'content_nested_columns'
        : parentType === 'repeat' && block.type === 'repeat'
          ? 'content_nested_repeat'
          : 'content_block_not_allowed_here',
    );
  }
  return replaceChildren(doc, parent, (list) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, list.length)), 0, block);
    return next;
  });
}

export function removeBlock(
  doc: EditorDocument,
  id: string,
): { doc: EditorDocument; removed: EditorBlock; path: Path } | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const parent = found.path.slice(0, -1);
  const index = found.path[found.path.length - 1];
  const next = replaceChildren(doc, parent, (list) => list.filter((_, i) => i !== index));
  return { doc: next, removed: found.block, path: found.path };
}

function adjustAfterRemoval(target: MoveTarget, removed: Path): MoveTarget | null {
  const isInside =
    target.parent.length >= removed.length &&
    removed.every((value, i) => target.parent[i] === value);
  if (isInside) return null;
  const parent = [...target.parent];
  const depth = removed.length - 1;
  const sameBranch = removed.slice(0, depth).every((value, i) => parent[i] === value);
  if (sameBranch && parent.length > depth && parent[depth]! > removed[depth]!) parent[depth]! -= 1;
  let index = target.index;
  const sameParent =
    target.parent.length === depth &&
    removed.slice(0, depth).every((value, i) => target.parent[i] === value);
  if (sameParent && index > removed[depth]!) index -= 1;
  return { parent, index };
}

export function moveBlock(
  doc: EditorDocument,
  id: string,
  target: MoveTarget,
): EditorDocument | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  const removed = removeBlock(doc, id);
  if (!removed) return null;
  const adjusted = adjustAfterRemoval(target, removed.path);
  if (!adjusted) return null;
  if (!canContain(typeAt(removed.doc, adjusted.parent), found.block.type)) return null;
  return insertBlock(removed.doc, adjusted.parent, adjusted.index, removed.removed);
}

function cloneWithNewIds(block: EditorBlock, gen: () => string): EditorBlock {
  const copy: EditorBlock = { ...block, id: gen() };
  if (block.children) copy.children = block.children.map((child) => cloneWithNewIds(child, gen));
  return copy;
}

export function duplicateBlock(
  doc: EditorDocument,
  id: string,
  gen: () => string = newBlockId,
): { doc: EditorDocument; newId: string } | null {
  const found = findBlock(doc, id);
  if (!found) return null;
  if (found.block.type === 'footer') return null; // pravidlo S3: nejvýše jedna patička
  const copy = cloneWithNewIds(found.block, gen);
  const parent = found.path.slice(0, -1);
  const index = (found.path[found.path.length - 1] ?? 0) + 1;
  return { doc: insertBlock(doc, parent, index, copy), newId: copy.id };
}

function mapBlock(
  doc: EditorDocument,
  id: string,
  update: (block: EditorBlock) => EditorBlock,
): EditorDocument {
  const walk = (list: EditorBlock[]): EditorBlock[] =>
    list.map((block) => {
      if (block.id === id) return update(block);
      return block.children ? { ...block, children: walk(block.children) } : block;
    });
  return { ...doc, blocks: walk(doc.blocks) };
}

export function patchProps(
  doc: EditorDocument,
  id: string,
  patch: Record<string, unknown>,
): EditorDocument {
  return mapBlock(doc, id, (block) => ({ ...block, props: { ...block.props, ...patch } }));
}

export function setVisibility(
  doc: EditorDocument,
  id: string,
  condition: VisibilityCondition | null,
): EditorDocument {
  const found = findBlock(doc, id);
  if (!found) return doc;
  if (condition && found.block.type === 'footer') {
    throw new EditorOpError('content_condition_on_unsubscribe');
  }
  if (condition && (found.block.type === 'columns' || found.block.type === 'column')) {
    throw new EditorOpError('content_condition_not_allowed_here');
  }
  return mapBlock(doc, id, (block) => ({ ...block, visibleWhen: condition }));
}

export function countBlocks(doc: EditorDocument): number {
  const walk = (list: EditorBlock[]): number =>
    list.reduce((sum, block) => sum + 1 + (block.children ? walk(block.children) : 0), 0);
  return walk(doc.blocks);
}

export { blockAt, childrenOf, findBlock };
