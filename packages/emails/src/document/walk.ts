import type { AnyBlock, Document, InlineNode, RichText } from './types';

export type BlockVisit = {
  block: AnyBlock;
  pointer: string;
  depth: number;
  parent: AnyBlock | null;
};

/** Průchod shora dolů, do hloubky, v pořadí dokumentu. Jediné závazné pořadí v balíčku. */
export function* walkBlocks(doc: Document): Generator<BlockVisit> {
  for (let i = 0; i < doc.blocks.length; i += 1) {
    yield* walkBlock(doc.blocks[i]!, `/blocks/${i}`, 0, null);
  }
}

function* walkBlock(
  block: AnyBlock,
  pointer: string,
  depth: number,
  parent: AnyBlock | null,
): Generator<BlockVisit> {
  yield { block, pointer, depth, parent };
  const children = (block as { children?: AnyBlock[] }).children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i += 1) {
    yield* walkBlock(children[i]!, `${pointer}/children/${i}`, depth + 1, block);
  }
}

export type InlineVisit = { node: InlineNode; pointer: string };

/** Průchod bohatým textem. `base` je pointer na samotné pole RichText. */
export function* walkRichText(rich: RichText, base: string): Generator<InlineVisit> {
  for (let i = 0; i < rich.length; i += 1) {
    const node = rich[i]!;
    if (node.t === 'p') {
      yield* walkInline(node.children, `${base}/${i}/children`);
    } else {
      for (let j = 0; j < node.items.length; j += 1) {
        yield* walkInline(node.items[j]!, `${base}/${i}/items/${j}`);
      }
    }
  }
}

function* walkInline(nodes: InlineNode[], base: string): Generator<InlineVisit> {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const pointer = `${base}/${i}`;
    yield { node, pointer };
    if (node.t === 'a') {
      yield* walkInline(node.children, `${pointer}/children`);
    }
  }
}

/** Všechna pole RichText v bloku, v pořadí, ve kterém je emitter vykresluje. */
export function richTextFieldsOf(block: AnyBlock): Array<{ rich: RichText; key: string }> {
  const props = (block as { props?: Record<string, unknown> }).props ?? {};
  const keys =
    block.type === 'heading' || block.type === 'text'
      ? ['content']
      : block.type === 'button'
        ? ['label']
        : block.type === 'footer'
          ? ['senderInfo']
          : [];
  return keys
    .filter((key) => Array.isArray(props[key]))
    .map((key) => ({ rich: props[key] as RichText, key }));
}

/**
 * Všechna URL pole bloku, tedy místa, kam autor píše odkaz.
 *
 * Existuje kvůli sběrači proměnných: `richTextFieldsOf` vrací jen bohatý text,
 * takže `{{ data.reset_url }}` v poli `href` do `usedPaths` nikdy nedoteklo
 * a tlačítko odešlo s prázdným odkazem, tiše. Inline uzly `a` tady nejsou,
 * ty se sbírají průchodem bohatého textu.
 */
export function urlFieldsOf(block: AnyBlock): Array<{ href: string; pointer: string }> {
  const props = (block as { props?: Record<string, unknown> }).props ?? {};
  if (block.type === 'button' || block.type === 'image') {
    const href = props['href'];
    return typeof href === 'string' ? [{ href, pointer: '/props/href' }] : [];
  }
  if (block.type === 'social') {
    const items = Array.isArray(props['items'])
      ? (props['items'] as Array<{ href?: unknown }>)
      : [];
    return items.flatMap((item, i) =>
      typeof item.href === 'string' ? [{ href: item.href, pointer: `/props/items/${i}/href` }] : [],
    );
  }
  return [];
}

/** Tečková notace pro pole `errors[].path` na hranici API (konvence části 1, 4.2). */
export function pointerToDotted(pointer: string): string {
  return pointer.replace(/^\//, '').split('/').join('.');
}
