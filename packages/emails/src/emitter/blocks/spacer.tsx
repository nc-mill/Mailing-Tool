import type { CSSProperties, ReactElement } from 'react';
import type { SpacerBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { px } from '../style';
import { BlockFrame } from './frame';

export function SpacerBlockView({
  block,
  emitter,
}: { block: SpacerBlock } & EmitterProps): ReactElement {
  const p = block.props;
  return (
    <BlockFrame
      emitter={emitter}
      padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      tdStyle={{ msoLineHeightRule: 'exactly' } as CSSProperties}
    >
      {/* Bez pevné výšky, řádkování a nulové velikosti písma Outlook prázdnou buňku nezvětší. */}
      <div
        style={
          {
            height: px(p.height),
            lineHeight: px(p.height),
            fontSize: '0',
            msoLineHeightRule: 'exactly',
          } as CSSProperties
        }
      >
        &nbsp;
      </div>
    </BlockFrame>
  );
}
