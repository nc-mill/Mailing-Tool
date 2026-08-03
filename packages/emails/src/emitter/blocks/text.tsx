import type { ReactElement } from 'react';
import type { TextBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { RichTextView } from '../rich-text';
import { lineHeightStyle, px } from '../style';
import { BlockFrame } from './frame';

export function TextBlockView({
  block,
  emitter,
}: { block: TextBlock } & EmitterProps): ReactElement {
  const { theme } = emitter;
  const props = block.props;
  const size = props.fontSize ?? theme.baseFontSize;
  const lineHeight = props.lineHeight ?? theme.baseLineHeight;
  return (
    <BlockFrame
      emitter={emitter}
      padding={props.padding}
      backgroundColor={props.backgroundColor}
      hideOnMobile={props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      tdStyle={{
        fontFamily: props.fontFamily ? theme.fonts.body : theme.fonts.body,
        fontSize: px(size),
        color: theme.light.color(props.color),
        ...lineHeightStyle(size, lineHeight),
      }}
    >
      <RichTextView
        emitter={emitter}
        rich={props.content}
        color={theme.light.color(props.color)}
        linkColor={theme.light.color(props.linkColor)}
        align={props.align}
        style={{ fontSize: px(size), ...lineHeightStyle(size, lineHeight) }}
      />
    </BlockFrame>
  );
}
