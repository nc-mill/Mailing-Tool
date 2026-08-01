import type { InlineNode, RichNode, RichText } from './document-types';

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
export type TiptapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};

type TextInline = Extract<InlineNode, { t: 's' }>;
type VarInline = Extract<InlineNode, { t: 'var' }>;
type ParagraphNode = Extract<RichNode, { t: 'p' }>;

const MARK_BY_FLAG: Array<[flag: 'b' | 'i' | 'u' | 'strike', type: string]> = [
  ['b', 'bold'],
  ['i', 'italic'],
  ['u', 'underline'],
  ['strike', 'strike'],
];

function inlineToTiptap(node: InlineNode): TiptapNode[] {
  if (node.t === 'br') return [{ type: 'hardBreak' }];
  if (node.t === 'var') {
    return [
      {
        type: 'personalization',
        attrs: {
          expr: node.expr,
          fallback: node.fallback ?? null,
          dateFormat: node.dateFormat ?? null,
        },
      },
    ];
  }
  if (node.t === 'a') {
    const link: TiptapMark = {
      type: 'link',
      attrs: { href: node.href, trackable: node.trackable ?? true },
    };
    return node.children.flatMap((child) =>
      inlineToTiptap(child).map((out) =>
        out.type === 'text' ? { ...out, marks: [link, ...(out.marks ?? [])] } : out,
      ),
    );
  }
  const marks = MARK_BY_FLAG.filter(([flag]) => node[flag] === true).map(([, type]) => ({ type }));
  const out: TiptapNode = { type: 'text', text: node.v };
  if (marks.length > 0) out.marks = marks;
  return [out];
}

function inlinesToTiptap(children: InlineNode[]): TiptapNode[] {
  return children.flatMap(inlineToTiptap);
}

export function richTextToTiptap(rich: RichText): TiptapNode {
  const content = rich.map((node): TiptapNode => {
    if (node.t === 'p') {
      const paragraph: TiptapNode = { type: 'paragraph', attrs: { align: node.align ?? null } };
      const inner = inlinesToTiptap(node.children);
      if (inner.length > 0) paragraph.content = inner;
      return paragraph;
    }
    const listType = node.t === 'ul' ? 'bulletList' : 'orderedList';
    return {
      type: listType,
      content: node.items.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', attrs: { align: null }, content: inlinesToTiptap(item) }],
      })),
    };
  });
  return { type: 'doc', content };
}

function tiptapInlines(nodes: TiptapNode[] = []): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out.push({ t: 'br' });
      continue;
    }
    if (node.type === 'personalization') {
      const item: VarInline = { t: 'var', expr: String(node.attrs?.expr ?? '') };
      if (node.attrs?.fallback) item.fallback = String(node.attrs.fallback);
      if (node.attrs?.dateFormat) {
        item.dateFormat = String(node.attrs.dateFormat) as NonNullable<VarInline['dateFormat']>;
      }
      out.push(item);
      continue;
    }
    if (node.type !== 'text') continue;
    const link = node.marks?.find((mark) => mark.type === 'link');
    const text: TextInline = { t: 's', v: node.text ?? '' };
    for (const [flag, type] of MARK_BY_FLAG) {
      if (node.marks?.some((mark) => mark.type === type)) text[flag] = true;
    }
    if (!link) {
      out.push(text);
      continue;
    }
    const href = String(link.attrs?.href ?? '');
    const trackable = link.attrs?.trackable !== false;
    const last = out[out.length - 1];
    if (last && last.t === 'a' && last.href === href && (last.trackable ?? true) === trackable) {
      last.children.push(text);
    } else {
      out.push({ t: 'a', href, trackable, children: [text] });
    }
  }
  return out;
}

export function tiptapToRichText(doc: TiptapNode): RichText {
  const nodes = (doc.content ?? [])
    .map((node): RichNode | null => {
      if (node.type === 'paragraph') {
        const children = tiptapInlines(node.content);
        const align = node.attrs?.align;
        if (align && align !== 'left') {
          return { t: 'p', children, align: String(align) as NonNullable<ParagraphNode['align']> };
        }
        return { t: 'p', children };
      }
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        return {
          t: node.type === 'bulletList' ? 'ul' : 'ol',
          items: (node.content ?? []).map((item) => tiptapInlines(item.content?.[0]?.content)),
        } as RichNode;
      }
      return null;
    })
    .filter((node): node is RichNode => node !== null);
  return nodes.length > 0 ? nodes : [{ t: 'p', children: [] }];
}
