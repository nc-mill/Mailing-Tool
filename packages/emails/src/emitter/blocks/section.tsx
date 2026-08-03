import type { ReactElement } from 'react';
import type { ColumnsBlock, SectionBlock } from '../../document/types';
import { assetUrl } from '../assets';
import type { EmitterProps } from '../ctx';
import { Raw } from '../raw';
import { paddingStyle, px } from '../style';
import { Visible } from '../visibility';
import { ColumnsBlockView } from './columns';
import { ContentBlockView } from './dispatch';

export function SectionBlockView({
  block,
  emitter,
}: { block: SectionBlock } & EmitterProps): ReactElement {
  const { theme, assets, assetBaseUrl } = emitter;
  const p = block.props;
  const innerWidth = theme.contentWidth - p.padding.left - p.padding.right;
  const outer = p.outerBackgroundColor
    ? theme.light.color(p.outerBackgroundColor)
    : theme.light.roles['surface.canvas'];
  const inner = p.backgroundColor
    ? theme.light.color(p.backgroundColor)
    : theme.light.roles['surface.content'];
  const backgroundAsset = p.backgroundImageAssetId ? assets[p.backgroundImageAssetId] : undefined;
  const backgroundSrc = backgroundAsset
    ? assetUrl(assetBaseUrl, backgroundAsset, 'w1200')
    : undefined;

  const content = (
    <table
      role="presentation"
      className="ml-content"
      {...(p.fullWidth ? {} : { width: theme.contentWidth })}
      cellPadding={0}
      cellSpacing={0}
      border={0}
      align="center"
      style={{
        ...(p.fullWidth ? { width: '100%' } : { width: px(theme.contentWidth), maxWidth: '100%' }),
        borderCollapse: 'collapse',
        backgroundColor: inner,
        borderTopLeftRadius: p.roundedTop ? px(theme.radius) : undefined,
        borderTopRightRadius: p.roundedTop ? px(theme.radius) : undefined,
        borderBottomLeftRadius: p.roundedBottom ? px(theme.radius) : undefined,
        borderBottomRightRadius: p.roundedBottom ? px(theme.radius) : undefined,
      }}
    >
      <tbody>
        <tr>
          <td className="ml-pad" style={paddingStyle(p.padding)}>
            {block.children.map((child) =>
              child.type === 'columns' ? (
                // Přetypování po zúžení podle `type`: `UnknownBlock` má indexovou
                // signaturu, takže ze zúžení nikdy nevypadne sám od sebe.
                <ColumnsBlockView
                  key={child.id}
                  block={child as ColumnsBlock}
                  innerWidth={innerWidth}
                  emitter={emitter}
                />
              ) : (
                <ContentBlockView
                  key={child.id}
                  block={child}
                  width={innerWidth}
                  emitter={emitter}
                />
              ),
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <Visible when={block.visibleWhen}>
      <table
        role="presentation"
        className="ml-canvas"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: outer }}
      >
        <tbody>
          <tr>
            {/* Pozadí obrázkem se emituje atributem `background` na <td> plus VML pro Outlook.
                CSS background-image nefunguje ani ve Word enginu, ani na Seznamu, kde se
                pravidlo s url() zahodí celé. */}
            <td
              align="center"
              {...(backgroundSrc ? { background: backgroundSrc } : {})}
              style={{
                backgroundColor: outer,
                ...(backgroundSrc
                  ? { backgroundPosition: p.backgroundPosition, backgroundSize: 'cover' }
                  : {}),
              }}
            >
              {backgroundSrc ? (
                <Raw
                  emitter={emitter}
                  html={
                    `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" ` +
                    `fill="true" stroke="false" style="width:${theme.contentWidth}px;">` +
                    `<v:fill type="frame" src="${backgroundSrc}" color="${outer}" /><v:textbox inset="0,0,0,0"><![endif]-->`
                  }
                />
              ) : null}
              {content}
              {backgroundSrc ? (
                <Raw
                  html="<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->"
                  emitter={emitter}
                />
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </Visible>
  );
}
