import type { InlineNode } from '../document/types';
import { varOutput } from './rich-text';

/**
 * Escapování přesně podle kontraktu (část 1, 4.10.2): & < > " '.
 * Používá se tam, kde HTML skládáme sami a React ho nevidí, tedy v raw slotech.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Inline uzly na HTML řetězec. Uživatelský text se escapuje, Liquid konstrukce ne,
 * protože ta v HTML kontextu není text uživatele, ale výraz, který interpoluje sender.
 */
export function inlineToHtmlString(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.t === 's') {
        let out = escapeHtml(node.v);
        if (node.strike) out = `<s>${out}</s>`;
        if (node.u) out = `<u>${out}</u>`;
        if (node.i) out = `<em>${out}</em>`;
        if (node.b) out = `<strong>${out}</strong>`;
        return out;
      }
      if (node.t === 'br') return '<br />';
      if (node.t === 'var') return varOutput(node);
      return inlineToHtmlString(node.children);
    })
    .join('');
}

/** Zploštění bohatého textu na jeden řádek, pro popisek tlačítka a VML variantu. */
export function richToSingleLineHtml(rich: { t: string }[]): string {
  const nodes: InlineNode[] = [];
  for (const node of rich as Array<{
    t: string;
    children?: InlineNode[];
    items?: InlineNode[][];
  }>) {
    if (node.t === 'p' && node.children) nodes.push(...node.children);
    if (node.items) for (const item of node.items) nodes.push(...item);
  }
  return inlineToHtmlString(nodes);
}

/** Délka viditelného textu, bez značek a bez Liquid konstrukcí. Používá se k odhadu šířky VML. */
export function visibleLength(rich: { t: string }[]): number {
  const html = richToSingleLineHtml(rich);
  return html.replace(/\{\{[^}]*\}\}/g, '12345678').replace(/<[^>]+>/g, '').length;
}
