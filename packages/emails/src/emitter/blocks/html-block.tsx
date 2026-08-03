import type { ReactElement } from 'react';
import sanitizeHtml from 'sanitize-html';
import type { HtmlBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { Raw } from '../raw';
import { BlockFrame } from './frame';

/**
 * Allowlist, ne blocklist (3.2.10). `style` a `script` v seznamu nejsou schválně:
 * uživatelský `<style>` by přebil naše media query a tmavý režim, a `juice`
 * se v MVP 0 nepoužívá, takže by ho nikdo neinlinoval.
 */
export const HTML_BLOCK_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'center',
    'code',
    'div',
    'em',
    'font',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  allowedAttributes: {
    '*': [
      'style',
      'class',
      'align',
      'valign',
      'width',
      'height',
      'bgcolor',
      'dir',
      'lang',
      'title',
      'role',
    ],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'border'],
    table: ['cellpadding', 'cellspacing', 'border'],
    font: ['color', 'face', 'size'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
};

export function HtmlBlockView({
  block,
  emitter,
}: { block: HtmlBlock } & EmitterProps): ReactElement {
  const safe = sanitizeHtml(block.props.code, HTML_BLOCK_SANITIZE);
  return (
    <BlockFrame
      emitter={emitter}
      padding={block.props.padding}
      backgroundColor={block.props.backgroundColor}
      hideOnMobile={block.props.hideOnMobile}
      visibleWhen={block.visibleWhen}
    >
      {/* Odkazy uvnitř tohohle bloku se vědomě netrackují (4.1.4): hledat v cizím
          markupu href by znamenalo ho parsovat, čemuž se celý kontrakt vyhýbá. */}
      <Raw html={safe} emitter={emitter} />
    </BlockFrame>
  );
}
