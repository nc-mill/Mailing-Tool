import type { ReactElement } from 'react';
import type { ColumnsBlock } from '../../document/types';
import { columnWidths } from '../../normalize/columns';
import { useEmitter } from '../ctx';
import { Raw } from '../raw';
import { paddingStyle, px } from '../style';
import { ContentBlockView } from './dispatch';

export function ColumnsBlockView({
  block,
  innerWidth,
}: {
  block: ColumnsBlock;
  innerWidth: number;
}): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  const widths = columnWidths(p.layout, p.gap, innerWidth);
  const order =
    p.stackOrder === 'reverse'
      ? block.children.map((_, index) => block.children.length - 1 - index)
      : block.children.map((_, index) => index);

  const ghostOpen =
    `<!--[if mso]><table role="presentation" width="${innerWidth}" cellpadding="0" cellspacing="0" ` +
    `border="0"><tr>`;
  const ghostCell = (width: number): string => `<td width="${width}" valign="${p.verticalAlign}">`;
  const ghostBetween = (width: number): string => `</td>${ghostCell(width)}`;

  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <tbody>
        <tr>
          <td valign={p.verticalAlign} style={{ fontSize: 0 }}>
            <Raw html={`${ghostOpen}${ghostCell(widths[order[0]!]!)}<![endif]-->`} />
            {order.map((columnIndex, position) => {
              const column = block.children[columnIndex]!;
              const width = widths[columnIndex]!;
              return (
                <span key={column.id}>
                  {position > 0 ? (
                    <Raw html={`<!--[if mso]>${ghostBetween(width)}<![endif]-->`} />
                  ) : null}
                  <div
                    className={p.stackOnMobile ? 'ml-col' : undefined}
                    style={{
                      display: 'inline-block',
                      width: px(width),
                      maxWidth: '100%',
                      verticalAlign: p.verticalAlign,
                      fontSize: px(theme.baseFontSize),
                    }}
                  >
                    <table
                      role="presentation"
                      width="100%"
                      cellPadding={0}
                      cellSpacing={0}
                      border={0}
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        borderRadius: px(column.props.borderRadius),
                        ...(column.props.backgroundColor
                          ? { backgroundColor: theme.light.color(column.props.backgroundColor) }
                          : {}),
                      }}
                    >
                      <tbody>
                        <tr>
                          <td style={paddingStyle(column.props.padding)}>
                            {column.children.map((child) => (
                              <ContentBlockView
                                key={child.id}
                                block={child}
                                width={
                                  width - column.props.padding.left - column.props.padding.right
                                }
                              />
                            ))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </span>
              );
            })}
            <Raw html="<!--[if mso]></td></tr></table><![endif]-->" />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
