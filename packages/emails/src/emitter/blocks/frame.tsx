import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ColorRef, Padding, VisibilityCondition } from '../../document/types';
import { useEmitter } from '../ctx';
import { paddingStyle } from '../style';
import { Visible } from '../visibility';

export type FrameProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  hideOnMobile: boolean;
  // `| undefined` je kvůli exactOptionalPropertyTypes, viz komentář u `Visible`.
  visibleWhen?: VisibilityCondition | null | undefined;
  tdStyle?: CSSProperties | undefined;
  align?: 'left' | 'center' | 'right' | undefined;
  children: ReactNode;
};

/**
 * Jednotný rám obsahového bloku: vlastní tabulka, odsazení na `<td>`, nikdy na `<div>`.
 * Word engine `padding` na `<div>` ignoruje a `margin` je v něm nespolehlivý.
 */
export function BlockFrame(props: FrameProps): ReactElement {
  const { theme } = useEmitter();
  const background = props.backgroundColor ? theme.light.color(props.backgroundColor) : undefined;
  return (
    <Visible when={props.visibleWhen}>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        className={props.hideOnMobile ? 'ml-hide-m' : undefined}
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <tbody>
          <tr>
            <td
              className="ml-pad"
              align={props.align ?? 'left'}
              style={{
                ...paddingStyle(props.padding),
                ...(background ? { backgroundColor: background } : {}),
                ...props.tdStyle,
              }}
            >
              {props.children}
            </td>
          </tr>
        </tbody>
      </table>
    </Visible>
  );
}
