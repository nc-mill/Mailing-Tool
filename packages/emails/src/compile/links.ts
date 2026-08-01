import { CLICK_MARKER_PREFIX, deriveLinkId, ZERO_UUID } from '@mlain/contracts/markers';
import type { Issue } from '../issue';
import type { ButtonBlock, Document, ImageBlock, RichText } from '../document/types';
import { MAX_LINKS_PER_DOCUMENT } from '../document/types';
import { richTextFieldsOf, walkBlocks, walkRichText } from '../document/walk';
import type { CompiledLink } from './types';

export type CollectLinksOptions = {
  campaignId?: string | undefined;
  trackClicks: boolean;
  skippedBlockIds: Set<string>;
};

export type CollectedLinks = {
  links: CompiledLink[];
  /** Vrátí hodnotu atributu href, tedy buď značku, nebo původní adresu. */
  hrefFor: (href: string, trackable: boolean) => string;
  issues: Issue[];
  warnings: Issue[];
};

const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;
const HAS_LIQUID = /\{\{|\{%/;

function plainLabel(rich: RichText): string {
  const parts: string[] = [];
  for (const node of rich) {
    const inline = node.t === 'p' ? node.children : node.items.flat();
    for (const child of inline) if (child.t === 's') parts.push(child.v);
  }
  return parts.join('').trim();
}

/** Trackovatelný je jen statický absolutní odkaz http nebo https bez Liquidu. */
export function isTrackableTarget(href: string, trackable: boolean): boolean {
  const trimmed = href.trim();
  if (!trackable) return false;
  if (trimmed === '' || trimmed === '#') return false;
  if (SYSTEM_URL_TAG.test(trimmed)) return false;
  if (HAS_LIQUID.test(trimmed)) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

export function collectLinks(doc: Document, options: CollectLinksOptions): CollectedLinks {
  const byUrl = new Map<string, CompiledLink>();
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const campaignId = options.campaignId ?? ZERO_UUID;

  if (!options.campaignId) {
    // Nulové UUID místo náhodného: odvození zůstane deterministické, takže dva
    // náhledy téhož dokumentu dají bajtově shodný výstup.
    warnings.push({ code: 'link_ids_not_campaign_scoped', severity: 'warning', pointer: '' });
  }

  const record = (href: string, trackable: boolean, label: string): void => {
    if (!isTrackableTarget(href, trackable)) return;
    const url = href.trim();
    if (byUrl.has(url)) return;
    const position = byUrl.size + 1;
    byUrl.set(url, {
      id: deriveLinkId(campaignId, position),
      position,
      url,
      trackable: true,
      label,
    });
  };

  for (const { block, pointer } of walkBlocks(doc)) {
    if (options.skippedBlockIds.has(block.id)) continue;
    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t !== 'a') continue;
        record(
          node.href,
          node.trackable !== false,
          plainLabel([{ t: 'p', children: node.children }]),
        );
      }
    }
    // Přetypování po zúžení podle `type`: v `AnyBlock` je i `UnknownBlock`
    // s indexovou signaturou, takže `block.props` by samo o sobě bylo `unknown`.
    if (block.type === 'button') {
      const button = block as ButtonBlock;
      record(button.props.href, button.props.trackable, plainLabel(button.props.label));
    }
    if (block.type === 'image') {
      const image = block as ImageBlock;
      if (image.props.href) {
        record(image.props.href, image.props.trackable, image.props.alt);
      }
    }
    // Odkazy uvnitř bloku `html` a v sociálních ikonách se vědomě netrackují (4.1.4).
  }

  const links = [...byUrl.values()];
  if (links.length > MAX_LINKS_PER_DOCUMENT) {
    issues.push({
      code: 'content_too_many_links',
      severity: 'error',
      pointer: '',
      params: { count: links.length },
    });
  }

  const hrefFor = (href: string, trackable: boolean): string => {
    if (!options.trackClicks) return href;
    if (!isTrackableTarget(href, trackable)) return href;
    const link = byUrl.get(href.trim());
    return link ? `${CLICK_MARKER_PREFIX}${link.id}` : href;
  };

  return { links, hrefFor, issues, warnings };
}
