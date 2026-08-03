import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { HexColor, InlineNode, RichText, VarInline } from '../document/types';
import { filterSlotMarker } from '../normalize/slots';
import type { EmitterProps } from './ctx';

/**
 * Vyrobí Liquid výstup z uzlu `var`. Argument filtru se vkládá záměnou přesně
 * za název filtru, aby zbytek výrazu zůstal znak po znaku takový, jak ho napsal
 * autor (kritérium 12). Přeskládání výrazu by ten slib porušilo.
 */
export function varOutput(node: VarInline): string {
  let expr = node.expr;
  if (node.slots?.date !== undefined) {
    expr = expr.replace(/(\|\s*date)(?![\w])/, `$1:${filterSlotMarker(node.slots.date)}`);
  }
  if (node.slots?.default !== undefined) {
    expr = expr.replace(/(\|\s*default)(?![\w])/, `$1:${filterSlotMarker(node.slots.default)}`);
  }
  return `{{ ${expr} }}`;
}

function marks(node: Extract<InlineNode, { t: 's' }>): ReactNode {
  // Pevné pořadí obalů, jinak by se snapshoty rozjížděly podle pořadí klíčů v JSON.
  let out: ReactNode = node.v;
  if (node.strike) out = <s>{out}</s>;
  if (node.u) out = <u>{out}</u>;
  if (node.i) out = <em>{out}</em>;
  if (node.b) out = <strong>{out}</strong>;
  return out;
}

function Inline({
  nodes,
  linkColor,
  emitter,
}: { nodes: InlineNode[]; linkColor: HexColor } & EmitterProps): ReactElement {
  const { linkHref } = emitter;
  return (
    <>
      {nodes.map((node, index) => {
        if (node.t === 's') return <span key={index}>{marks(node)}</span>;
        if (node.t === 'br') return <br key={index} />;
        if (node.t === 'var') return <span key={index}>{varOutput(node)}</span>;
        return (
          <a
            key={index}
            className="ml-link"
            href={linkHref(node.href, node.trackable !== false)}
            style={{ color: linkColor, textDecoration: 'underline' }}
          >
            <Inline nodes={node.children} linkColor={linkColor} emitter={emitter} />
          </a>
        );
      })}
    </>
  );
}

export function RichTextView({
  rich,
  color,
  linkColor,
  style,
  align,
  emitter,
}: {
  rich: RichText;
  color: HexColor;
  linkColor: HexColor;
  style?: CSSProperties;
  align?: 'left' | 'center' | 'right' | 'justify';
} & EmitterProps): ReactElement {
  const paragraph: CSSProperties = { margin: 0, color, textAlign: align ?? 'left', ...style };
  return (
    <>
      {rich.map((node, index) => {
        if (node.t === 'p') {
          return (
            <p
              key={index}
              className="ml-text"
              style={{ ...paragraph, textAlign: node.align ?? paragraph.textAlign }}
            >
              <Inline nodes={node.children} linkColor={linkColor} emitter={emitter} />
            </p>
          );
        }
        const List = node.t === 'ul' ? 'ul' : 'ol';
        return (
          <List key={index} className="ml-text" style={{ ...paragraph, paddingLeft: '24px' }}>
            {node.items.map((item, itemIndex) => (
              <li key={itemIndex} style={{ color }}>
                <Inline nodes={item} linkColor={linkColor} emitter={emitter} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
