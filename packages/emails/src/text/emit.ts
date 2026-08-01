import { convert } from 'html-to-text';
import { varOutput } from '../emitter/rich-text';
import { visibilityTags } from '../emitter/visibility';
import type {
  AnyBlock,
  ColumnsBlock,
  ContentBlock,
  InlineNode,
  RichText,
  SectionChild,
  VisibilityCondition,
} from '../document/types';
import type { NormalizedDocument } from '../normalize/index';
import { PLAIN_TEXT_WIDTH, wrapPlain } from './wrap';

export type TextRenderOptions = {
  normalized: NormalizedDocument;
  linkHref: (href: string, trackable: boolean) => string;
};

type Collected = { text: string; markers: string[] };

export function renderDocumentText(options: TextRenderOptions): string {
  const lines: string[] = [];
  for (const section of options.normalized.doc.blocks) {
    if (options.normalized.skippedBlockIds.has(section.id)) continue;
    pushConditional(lines, section, (out) => {
      for (const child of section.children) emitChild(out, child, options);
    });
  }
  return finish(lines);
}

function pushConditional(lines: string[], block: AnyBlock, body: (out: string[]) => void): void {
  const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
  if (condition) lines.push(visibilityTags(condition)[0]);
  body(lines);
  if (condition) lines.push(visibilityTags(condition)[1]);
}

function emitChild(lines: string[], block: SectionChild, options: TextRenderOptions): void {
  if (options.normalized.skippedBlockIds.has(block.id)) return;
  if (block.type === 'columns') {
    // Sloupcová sazba v prostém textu nefunguje, sloupce jdou pod sebe.
    const columns = block as ColumnsBlock;
    for (const column of columns.children) {
      for (const child of column.children) emitChild(lines, child, options);
      lines.push('');
    }
    return;
  }
  pushConditional(lines, block, (out) => emitBlock(out, block, options));
}

function emitBlock(lines: string[], block: SectionChild, options: TextRenderOptions): void {
  // `SectionChild` obsahuje i `UnknownBlock` s indexovou signaturou, takže zúžení
  // podle `type` z něj samo o sobě nikdy neodejde. Neznámý typ sem nedojde,
  // normalizace ho zapsala do skippedBlockIds; větev `default` je druhá vrstva.
  const known = block as ContentBlock;
  switch (known.type) {
    case 'heading': {
      const { text, markers } = collect(known.props.content, options);
      if (text.trim() === '') return;
      lines.push(...wrapPlain(text));
      // Úroveň 3 se schválně nepřevádí na velká písmena: rozbila by diakritiku
      // i Liquid výrazy, přesně jak to dělá toPlainText z react-emailu.
      if (known.props.level === 1) lines.push('='.repeat(Math.min(text.length, PLAIN_TEXT_WIDTH)));
      if (known.props.level === 2) lines.push('-'.repeat(Math.min(text.length, PLAIN_TEXT_WIDTH)));
      lines.push(...markers, '');
      return;
    }
    case 'text': {
      for (const node of known.props.content) {
        if (node.t === 'p') {
          const { text, markers } = collect([node], options);
          if (text.trim() !== '') lines.push(...wrapPlain(text), ...markers, '');
          continue;
        }
        node.items.forEach((item, index) => {
          const { text, markers } = collectInline(item, options);
          const bullet = node.t === 'ul' ? '- ' : `${index + 1}. `;
          const indent = node.t === 'ul' ? '  ' : '   ';
          lines.push(...wrapPlain(bullet + text, { indent }), ...markers);
        });
        lines.push('');
      }
      return;
    }
    case 'image': {
      if (known.props.decorative) return;
      if (known.props.alt.trim() !== '') lines.push(`[${known.props.alt}]`);
      if (known.props.href) lines.push(options.linkHref(known.props.href, known.props.trackable));
      lines.push('');
      return;
    }
    case 'button': {
      const { text } = collect(known.props.label, options);
      lines.push('', `>> ${text}:`, options.linkHref(known.props.href, known.props.trackable), '');
      return;
    }
    case 'divider':
      lines.push('', '-'.repeat(40), '');
      return;
    case 'spacer':
      lines.push('');
      return;
    case 'social': {
      for (const item of known.props.items) {
        lines.push(`${item.label ?? item.network}:`, options.linkHref(item.href, false));
      }
      lines.push('');
      return;
    }
    case 'footer': {
      const { text } = collect(known.props.senderInfo, options);
      lines.push('', ...wrapPlain(text), '');
      if (known.props.showUnsubscribe) {
        lines.push(`${known.props.unsubscribeLabel}: {{ unsubscribe_url }}`);
      }
      if (known.props.showPreferences) {
        lines.push(`${known.props.preferencesLabel}: {{ preferences_url }}`);
      }
      if (known.props.showWebview) {
        lines.push(`${known.props.webviewLabel}: {{ webview_url }}`);
      }
      lines.push('');
      return;
    }
    case 'html': {
      // Jediné místo, kde se převádí z HTML, protože jiná informace tam není.
      const converted = convert(known.props.code, {
        wordwrap: PLAIN_TEXT_WIDTH,
        selectors: [{ selector: 'a', options: { ignoreHref: true } }],
      });
      lines.push(...converted.split('\n'), '');
      return;
    }
    default:
      return;
  }
}

function collect(rich: RichText, options: TextRenderOptions): Collected {
  const parts: string[] = [];
  const markers: string[] = [];
  for (const node of rich) {
    if (node.t === 'p') {
      const inline = collectInline(node.children, options);
      parts.push(inline.text);
      markers.push(...inline.markers);
    } else {
      for (const item of node.items) {
        const inline = collectInline(item, options);
        parts.push(inline.text);
        markers.push(...inline.markers);
      }
    }
  }
  return { text: parts.join(' ').trim(), markers };
}

function collectInline(nodes: InlineNode[], options: TextRenderOptions): Collected {
  let text = '';
  const markers: string[] = [];
  for (const node of nodes) {
    if (node.t === 's') {
      // Značky tučného a kurzívy se zahazují, `*text*` vypadá v prostém textu jako chyba.
      text += node.v;
    } else if (node.t === 'br') {
      text += ' ';
    } else if (node.t === 'var') {
      text += varOutput(node);
    } else {
      const inner = collectInline(node.children, options);
      text += inner.text;
      markers.push(...inner.markers, options.linkHref(node.href, node.trackable !== false));
    }
  }
  return { text, markers };
}

/** Sesbírané řádky na hotový text: nejvýše jeden prázdný řádek za sebou, konce CRLF. */
function finish(lines: string[]): string {
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blanks += 1;
      if (blanks > 1) continue;
      out.push('');
      continue;
    }
    blanks = 0;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return `${out.join('\r\n')}\r\n`;
}
