import type { ReactElement } from 'react';
import type { ContentBlock, SectionChild } from '../../document/types';
import { useEmitter } from '../ctx';
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
}: {
  block: SectionChild;
  width: number;
}): ReactElement | null {
  const { skippedBlockIds } = useEmitter();
  if (skippedBlockIds.has(block.id)) return null;
  // `SectionChild` obsahuje i `UnknownBlock` s indexovou signaturou, takže zúžení
  // podle `type` z něj samo o sobě nikdy neodejde. Neznámý typ sem stejně nedojde,
  // normalizace ho zapsala do skippedBlockIds; větev `default` je druhá vrstva.
  const known = block as ContentBlock;
  switch (known.type) {
    case 'heading':
      return <HeadingBlockView block={known} />;
    case 'text':
      return <TextBlockView block={known} />;
    case 'image':
      return <ImageBlockView block={known} width={width} />;
    case 'button':
      return <ButtonBlockView block={known} width={width} />;
    case 'divider':
      return <DividerBlockView block={known} />;
    case 'spacer':
      return <SpacerBlockView block={known} />;
    case 'html':
      return <HtmlBlockView block={known} />;
    case 'social':
      return <SocialBlockView block={known} />;
    case 'footer':
      return <FooterBlockView block={known} />;
    default:
      return null;
  }
}
