import type { ReactElement } from 'react';
import type { HeadingBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { RichTextView } from '../rich-text';
import { lineHeightStyle, px } from '../style';
import { BlockFrame } from './frame';

export function HeadingBlockView({
  block,
  emitter,
}: { block: HeadingBlock } & EmitterProps): ReactElement {
  const { theme } = emitter;
  const props = block.props;
  const size = props.fontSize ?? theme.headingSize(props.level);
  const lineHeight = props.lineHeight ?? 1.25;
  const Tag = (['h1', 'h2', 'h3'] as const)[props.level - 1]!;
  return (
    <BlockFrame
      emitter={emitter}
      padding={props.padding}
      backgroundColor={props.backgroundColor}
      hideOnMobile={props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={props.align}
    >
      <Tag
        className={`ml-h${props.level} ml-text`}
        style={{
          margin: 0,
          fontFamily: props.fontFamily ? theme.fonts.heading : theme.fonts.heading,
          fontSize: px(size),
          fontWeight: props.fontWeight,
          letterSpacing: px(props.letterSpacing),
          textAlign: props.align,
          color: theme.light.color(props.color),
          ...lineHeightStyle(size, lineHeight),
        }}
      >
        <RichTextView
          emitter={emitter}
          rich={props.content}
          color={theme.light.color(props.color)}
          linkColor={theme.light.roles['link.default']}
          align={props.align}
          style={{ fontSize: px(size), fontWeight: props.fontWeight }}
        />
      </Tag>
    </BlockFrame>
  );
}
