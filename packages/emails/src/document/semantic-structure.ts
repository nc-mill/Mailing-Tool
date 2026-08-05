import type { Issue } from '../issue';
import { columnWidths } from '../normalize/columns';
import {
  MAX_BLOCKS_PER_DOCUMENT,
  MAX_LINKS_PER_DOCUMENT,
  type ColumnsBlock,
  type Document,
  type FooterBlock,
  type HtmlBlock,
  type ImageBlock,
  type ButtonBlock,
  type InlineNode,
  type SectionBlock,
  type SocialBlock,
} from './types';
import { pointerToDotted, richTextFieldsOf, walkBlocks, walkRichText } from './walk';

export type StructureContext = { templateKind: 'campaign' | 'transactional' | 'system' };

/**
 * Vyhrazené řetězce (4.1.5 plus raw slot z rozhodnutí D3).
 * Bez zákazu by si uživatel textem odklonil cizí náhradní hodnotu nebo vložil syrové HTML.
 */
export const RESERVED_MARKER_PATTERNS = [
  /mlain\.invalid/i,
  /ML_OPEN_PIXEL/i,
  /ML_ARG_/i,
  /ML_RAW_/i,
];

const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;
const HAS_LIQUID = /\{\{|\{%/;
const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:'];

const issue = (
  code: string,
  severity: Issue['severity'],
  pointer: string,
  params?: Record<string, string | number>,
): Issue => ({ code, severity, pointer, path: pointerToDotted(pointer), params });

/**
 * Je odkaz v šabloně tohohle druhu vůbec sledovatelný?
 *
 * Transakční profil se kompiluje s `trackClicks: false` (viz `test-send.ts`
 * a `delivery-email.ts`), takže vlastnost bloku `trackable` je v něm mrtvá:
 * značka nevznikne a sledovat se nemá co. Vynucuje se to TÍMHLE PROFILEM,
 * ne obejitím kontroly, takže `liquid_in_trackable_href` u kampaňové šablony
 * platí beze změny.
 *
 * Důvod je věcný, ne pohodlnost: transakční odkaz bývá jednorázový a kdyby šel
 * přes `/t/c/`, bezpečnostní skener v poštovní schránce by ho otevřel a token
 * spotřeboval dřív než člověk.
 */
function tracksLinks(kind: StructureContext['templateKind']): boolean {
  return kind !== 'transactional';
}

export function checkStructure(doc: Document, ctx: StructureContext): Issue[] {
  const issues: Issue[] = [];
  const tracks = tracksLinks(ctx.templateKind);
  const trackable = (declared: boolean): boolean => declared && tracks;
  const seenIds = new Set<string>();
  let blockCount = 0;
  let footerCount = 0;
  let linkCount = 0;
  const unsubscribeCarriers: Array<{ pointer: string; conditional: boolean }> = [];

  for (const visit of walkBlocks(doc)) {
    const { block, pointer, depth, parent } = visit;
    blockCount += 1;

    // S1
    if (seenIds.has(block.id)) {
      issues.push(issue('content_duplicate_block_id', 'error', pointer, { id: block.id }));
    } else {
      seenIds.add(block.id);
    }

    // S2
    if (block.type === 'columns' && parent?.type === 'column') {
      issues.push(issue('content_nested_columns', 'error', pointer));
    }

    // S15
    if (block.type === 'repeat' && parent?.type === 'repeat') {
      issues.push(issue('content_nested_repeat', 'error', pointer));
    }

    // S3
    if (block.type === 'footer') {
      footerCount += 1;
      if (footerCount > 1) issues.push(issue('content_duplicate_footer', 'error', pointer));
    }

    // S10
    if (block.type === 'html' && ctx.templateKind === 'system') {
      issues.push(issue('content_raw_html_forbidden', 'error', pointer));
    }

    // S5. Přímo v sekci je dostupná šířka celá vnitřní šířka sekce,
    // uvnitř sloupce je to pixelová šířka sloupce minus jeho odsazení.
    const props = (block as { props?: Record<string, unknown> }).props;
    const padding = props?.['padding'] as { left: number; right: number } | undefined;
    if (padding && depth > 0) {
      const width = availableWidthAt(doc, pointer);
      if (width !== null && padding.left + padding.right > width - 40) {
        issues.push(
          issue('content_padding_overflow', 'error', pointer, {
            padding: padding.left + padding.right,
            width,
          }),
        );
      }
    }

    // S16 plus pravidla o odkazech, procházejí se všechna pole bohatého textu
    for (const field of richTextFieldsOf(block)) {
      const base = `${pointer}/props/${field.key}`;
      for (const { node, pointer: inlinePointer } of walkRichText(field.rich, base)) {
        checkReserved(node, inlinePointer, issues);
        if (node.t !== 'a') continue;
        linkCount += 1;
        checkHref(node.href, trackable(node.trackable !== false), inlinePointer, issues, tracks);
        const systemTag = node.href.trim().match(SYSTEM_URL_TAG);
        if (systemTag?.[1] === 'unsubscribe_url') {
          unsubscribeCarriers.push({
            pointer,
            conditional: Boolean((block as { visibleWhen?: unknown }).visibleWhen),
          });
        }
      }
    }

    // Přetypování po zúžení podle `type`: v `AnyBlock` je i `UnknownBlock`
    // s indexovou signaturou, takže `block.props` by samo o sobě bylo `unknown`.
    if (block.type === 'image') {
      const image = block as ImageBlock;
      if (image.props.href) {
        linkCount += 1;
        checkHref(
          image.props.href,
          trackable(image.props.trackable),
          `${pointer}/props/href`,
          issues,
          tracks,
        );
      }
      checkReservedString(image.props.alt, `${pointer}/props/alt`, issues);
    }
    if (block.type === 'button') {
      const button = block as ButtonBlock;
      linkCount += 1;
      checkHref(
        button.props.href,
        trackable(button.props.trackable),
        `${pointer}/props/href`,
        issues,
        tracks,
      );
    }
    if (block.type === 'html') {
      checkReservedString((block as HtmlBlock).props.code, `${pointer}/props/code`, issues);
    }
    if (block.type === 'social') {
      const social = block as SocialBlock;
      for (let i = 0; i < social.props.items.length; i += 1) {
        linkCount += 1;
        checkHref(
          social.props.items[i]!.href,
          false,
          `${pointer}/props/items/${i}/href`,
          issues,
          tracks,
        );
      }
    }
    if (block.type === 'footer' && (block as FooterBlock).props.showUnsubscribe) {
      // Patička nemá visibleWhen už na úrovni schématu, takže je vždy nepodmíněná.
      unsubscribeCarriers.push({ pointer, conditional: false });
    }
  }

  // S14: jediný nositel odhlášení nesmí být podmíněný.
  if (unsubscribeCarriers.length === 1 && unsubscribeCarriers[0]!.conditional) {
    issues.push(
      issue('content_condition_on_unsubscribe', 'error', unsubscribeCarriers[0]!.pointer),
    );
  }

  if (blockCount > MAX_BLOCKS_PER_DOCUMENT) {
    issues.push(issue('content_too_many_blocks', 'error', '', { count: blockCount }));
  }
  if (linkCount > MAX_LINKS_PER_DOCUMENT) {
    issues.push(issue('content_too_many_links', 'error', '', { count: linkCount }));
  }
  return issues;
}

function checkReserved(node: InlineNode, pointer: string, issues: Issue[]): void {
  if (node.t === 's') checkReservedString(node.v, `${pointer}/v`, issues);
  if (node.t === 'var') {
    checkReservedString(node.expr, `${pointer}/expr`, issues);
    if (node.fallback) checkReservedString(node.fallback, `${pointer}/fallback`, issues);
  }
  if (node.t === 'a') checkReservedString(node.href, `${pointer}/href`, issues);
}

function checkReservedString(value: string, pointer: string, issues: Issue[]): void {
  if (RESERVED_MARKER_PATTERNS.some((pattern) => pattern.test(value))) {
    issues.push(issue('content_reserved_marker', 'error', pointer));
  }
}

function checkHref(
  href: string,
  trackable: boolean,
  pointer: string,
  issues: Issue[],
  tracksLinks = true,
): void {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed === '#') {
    issues.push(issue('content_link_anchor_only', 'error', pointer));
    return;
  }
  if (SYSTEM_URL_TAG.test(trimmed)) return;
  if (HAS_LIQUID.test(trimmed)) {
    // Kód se jmenuje liquid_in_trackable_href, takže je to chyba jen u trackovaného odkazu.
    if (trackable) {
      issues.push(issue('liquid_in_trackable_href', 'error', pointer));
      return;
    }
    // Varování dává smysl jen tam, kde se odkazy sledují: říká „tenhle jeden
    // se do statistiky nedostane". V šabloně, kde se nesleduje NIC, je
    // proměnná v odkazu normální stav, ne odchylka, a hlásit ji u každého
    // tlačítka by z transakční šablony udělalo trvale varovnou.
    if (tracksLinks) issues.push(issue('link_variable_not_tracked', 'warning', pointer));
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    issues.push(issue('content_link_scheme_forbidden', 'error', pointer, { href: trimmed }));
    return;
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    issues.push(
      issue('content_link_scheme_forbidden', 'error', pointer, { scheme: parsed.protocol }),
    );
  }
}

/** Dostupná šířka bloku podle jeho pozice ve stromu. */
function availableWidthAt(doc: Document, pointer: string): number | null {
  const parts = pointer.split('/').filter(Boolean);
  const section = doc.blocks[Number(parts[1])] as SectionBlock | undefined;
  if (!section) return null;
  const inner = doc.theme.contentWidth - section.props.padding.left - section.props.padding.right;
  // /blocks/i/children/j/children/k/children/l = sekce, columns, column, obsah
  if (parts.length < 8) return inner;
  const columns = section.children[Number(parts[3])] as ColumnsBlock | undefined;
  if (!columns || columns.type !== 'columns') return inner;
  const widths = columnWidths(columns.props.layout, columns.props.gap, inner);
  const column = columns.children[Number(parts[5])];
  const width = widths[Number(parts[5])];
  if (width === undefined || !column) return inner;
  return width - column.props.padding.left - column.props.padding.right;
}
