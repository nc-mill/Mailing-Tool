import type { ReactElement } from 'react';
import type { DividerBlock } from '../../document/types';
import { useEmitter } from '../ctx';
import { BlockFrame } from './frame';

export function DividerBlockView({ block }: { block: DividerBlock }): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      {/* Prázdná buňka s border-top, ne <hr>: ten má v každém klientovi jiný výchozí okraj. */}
      <table
        role="presentation"
        width={`${p.width}%`}
        cellPadding={0}
        cellSpacing={0}
        border={0}
        align={p.align}
        style={{ width: `${p.width}%`, borderCollapse: 'collapse' }}
      >
        <tbody>
          <tr>
            <td
              style={{
                borderTop: `${p.thickness}px ${p.style} ${theme.light.color(p.color)}`,
                fontSize: 0,
                lineHeight: '0px',
                height: 0,
              }}
            >
              &nbsp;
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  );
}
