import type { ReactElement } from 'react';
import type { ContentBlock, SectionChild } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { ButtonBlockView } from './button';
import { DividerBlockView } from './divider';
import { FooterBlockView } from './footer';
import { HeadingBlockView } from './heading';
import { HtmlBlockView } from './html-block';
import { ImageBlockView } from './image';
import { SocialBlockView } from './social';
import { SpacerBlockView } from './spacer';
import { TextBlockView } from './text';

/**
 * Rozcestník obsahových bloků. Neznámý typ a `repeat` sem nedojdou, protože je
 * normalizace zapsala do skippedBlockIds; kontrola je tu jako druhá vrstva.
 */
export function ContentBlockView({
  block,
  width,
  emitter,
}: {
  block: SectionChild;
  width: number;
} & EmitterProps): ReactElement | null {
  const { skippedBlockIds } = emitter;
  if (skippedBlockIds.has(block.id)) return null;
  // `SectionChild` obsahuje i `UnknownBlock` s indexovou signaturou, takže zúžení
  // podle `type` z něj samo o sobě nikdy neodejde. Neznámý typ sem stejně nedojde,
  // normalizace ho zapsala do skippedBlockIds; větev `default` je druhá vrstva.
  const known = block as ContentBlock;
  switch (known.type) {
    case 'heading':
      return <HeadingBlockView block={known} emitter={emitter} />;
    case 'text':
      return <TextBlockView block={known} emitter={emitter} />;
    case 'image':
      return <ImageBlockView block={known} width={width} emitter={emitter} />;
    case 'button':
      return <ButtonBlockView block={known} width={width} emitter={emitter} />;
    case 'divider':
      return <DividerBlockView block={known} emitter={emitter} />;
    case 'spacer':
      return <SpacerBlockView block={known} emitter={emitter} />;
    case 'html':
      return <HtmlBlockView block={known} emitter={emitter} />;
    case 'social':
      return <SocialBlockView block={known} emitter={emitter} />;
    case 'footer':
      return <FooterBlockView block={known} emitter={emitter} />;
    default:
      return null;
  }
}
