import type { Issue } from '../issue';
import { blockDefaults, KNOWN_BLOCK_TYPES, type BlockTypeWithDefaults } from '../document/defaults';
import type { AnyBlock, Document, SocialBlock, SocialNetwork } from '../document/types';
import { walkBlocks } from '../document/walk';
import { resolveTheme, type ResolvedTheme } from '../theme/resolve';
import { assignFilterSlots, type FilterSlot } from './slots';

/** Sítě, ke kterým dodáváme ikony. Rozšiřuje se aditivně, viz 3.2.11. */
export const KNOWN_SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  'facebook',
  'instagram',
  'x',
  'linkedin',
  'youtube',
  'tiktok',
  'threads',
  'pinterest',
  'bluesky',
  'mastodon',
  'web',
  'email',
];

/** Jazyky, ve kterých MVP 0 dodává texty produktu. */
export const SUPPORTED_LANGUAGES = ['cs', 'en'] as const;

export type NormalizedDocument = {
  doc: Document;
  theme: ResolvedTheme;
  filterSlots: FilterSlot[];
  /** Bloky, které emitter vynechá: neznámý typ a repeat v MVP 0. */
  skippedBlockIds: Set<string>;
  /** Efektivní jazyk dodávaných textů, vždy jeden ze SUPPORTED_LANGUAGES. */
  language: string;
  warnings: Issue[];
};

export function normalizeDocument(input: Document, opts: { language: string }): NormalizedDocument {
  const doc = structuredClone(input);
  const warnings: Issue[] = [];
  const skippedBlockIds = new Set<string>();

  for (const { block, pointer } of walkBlocks(doc)) {
    if (!KNOWN_BLOCK_TYPES.includes(block.type)) {
      skippedBlockIds.add(block.id);
      warnings.push({
        code: 'unknown_block_skipped',
        severity: 'warning',
        pointer,
        params: { type: block.type, id: block.id },
      });
      continue;
    }
    if (block.type === 'repeat') {
      skippedBlockIds.add(block.id);
      warnings.push({
        code: 'repeat_block_not_supported',
        severity: 'warning',
        pointer,
        params: { id: block.id },
      });
    }
    fillDefaults(block);
    if (block.type === 'social') {
      // Přetypování po zúžení podle `type`: v `AnyBlock` je i `UnknownBlock`
      // s indexovou signaturou, takže `block.props` by samo o sobě bylo `unknown`.
      const social = block as SocialBlock;
      const kept = social.props.items.filter((item) =>
        KNOWN_SOCIAL_NETWORKS.includes(item.network),
      );
      if (kept.length !== social.props.items.length) {
        for (const item of social.props.items) {
          if (KNOWN_SOCIAL_NETWORKS.includes(item.network)) continue;
          warnings.push({
            code: 'social_network_unknown',
            severity: 'warning',
            pointer,
            params: { network: item.network },
          });
        }
        social.props.items = kept;
      }
    }
  }

  const requested = opts.language || doc.meta.language;
  const base = requested.split('-')[0]!.toLowerCase();
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : 'en';
  if (language !== base) {
    // Kompilace nespadne, jazyk ovlivňuje jen dodávané texty a atribut lang (3.1.9).
    warnings.push({
      code: 'language_not_supported',
      severity: 'warning',
      pointer: '/meta/language',
      params: { language: requested },
    });
  }

  return {
    doc,
    theme: resolveTheme(doc.theme),
    filterSlots: assignFilterSlots(doc),
    skippedBlockIds,
    language,
    warnings,
  };
}

function fillDefaults(block: AnyBlock): void {
  const type = block.type as BlockTypeWithDefaults;
  const holder = block as { props?: Record<string, unknown> };
  holder.props = { ...(blockDefaults(type) as Record<string, unknown>), ...(holder.props ?? {}) };
}
