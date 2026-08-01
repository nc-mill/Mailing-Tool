import type { InlineNode, RichText } from '../document/types';

const LIQUID = /\{\{([^}]*)\}\}/g;

/**
 * Prostý text s podporou Liquid výrazů na RichText. Nikdy nevzniká HTML:
 * tím je zaručeno, že ani AI, ani žádná integrace nedokáže do šablony
 * dostat značky, protože jediná cesta k HTML je blok `html` (3.9.3).
 */
export function plainToRichText(input: string): RichText {
  if (input.trim() === '') return [{ t: 'p', children: [] }];
  return input
    .split(/\n{2,}/)
    .map((paragraph) => ({ t: 'p' as const, children: toInline(paragraph) }));
}

function toInline(paragraph: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;
  for (const match of paragraph.matchAll(LIQUID)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push({ t: 's', v: paragraph.slice(cursor, start) });
    nodes.push({ t: 'var', expr: match[1]!.trim() });
    cursor = start + match[0].length;
  }
  if (cursor < paragraph.length) nodes.push({ t: 's', v: paragraph.slice(cursor) });
  return nodes;
}
