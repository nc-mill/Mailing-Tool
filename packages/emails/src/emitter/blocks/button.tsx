import type { ReactElement } from 'react';
import type { ButtonBlock } from '../../document/types';
import type { EmitterProps } from '../ctx';
import { escapeHtml, richToSingleLineHtml, visibleLength } from '../inline-html';
import { Raw } from '../raw';
import { BlockFrame } from './frame';

export function ButtonBlockView({
  block,
  width,
  emitter,
}: {
  block: ButtonBlock;
  width: number;
} & EmitterProps): ReactElement {
  const { theme, linkHref } = emitter;
  const p = block.props;
  const href = linkHref(p.href, p.trackable);
  const background = theme.light.color(p.backgroundColor);
  const textColor = theme.light.color(p.textColor);
  const border = p.borderColor ? theme.light.color(p.borderColor) : background;
  const radius = p.borderRadius ?? theme.radius;
  const height = Math.round(p.fontSize * 1.2) + p.paddingY * 2;

  // Šířka VML se v Outlooku musí uvést v pixelech, jinak se tlačítko scvrkne.
  // U proměnného popisku je to odhad ze znaků: přesně to nejde, protože délku
  // interpolované hodnoty zná až sender. Odhad je vždy oříznutý šířkou sloupce.
  const estimated = Math.round(visibleLength(p.label) * p.fontSize * 0.6) + p.paddingX * 2;
  const vmlWidth = p.fullWidth ? width : Math.min(width, Math.max(80, estimated));
  const labelHtml = richToSingleLineHtml(p.label);
  // Odchylka od plánu: font stack se escapuje. Skládá se do atributu `style="..."`
  // ručně, mimo React, a systémový stack obsahuje `"Segoe UI"`. Neescapovaná
  // uvozovka atribut ukončí a zbytek stylu se rozpadne do neplatných atributů.
  const fontFamily = escapeHtml(theme.fonts.body);

  const vml =
    '<!--[if mso]>' +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" ` +
    `style="height:${height}px;v-text-anchor:middle;width:${vmlWidth}px;" ` +
    `arcsize="${Math.round((radius / height) * 100)}%" ` +
    `strokecolor="${border}" strokeweight="${p.borderWidth}px" ` +
    `fillcolor="${p.style === 'outline' ? '#ffffff' : background}">` +
    '<w:anchorlock/>' +
    `<center style="color:${p.style === 'outline' ? background : textColor};` +
    `font-family:${fontFamily};font-size:${p.fontSize}px;font-weight:bold;">${labelHtml}</center>` +
    '</v:roundrect><![endif]-->';

  const tableHtml =
    `<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `class="ml-btn"${p.fullWidth ? ` width="${width}"` : ''} ` +
    `style="border-collapse:separate;${p.fullWidth ? `width:${width}px;` : ''}">` +
    `<tbody><tr><td align="center" ` +
    `style="background-color:${p.style === 'outline' ? '#ffffff' : background};` +
    `border-radius:${radius}px;border:${p.borderWidth}px solid ${border};` +
    `padding:${p.paddingY}px ${p.paddingX}px;">` +
    `<a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;text-decoration:none;font-family:${fontFamily};` +
    `font-size:${p.fontSize}px;font-weight:bold;line-height:${Math.round(p.fontSize * 1.2)}px;` +
    `mso-line-height-rule:exactly;color:${p.style === 'outline' ? background : textColor};">` +
    `${labelHtml}</a></td></tr></tbody></table><!--<![endif]-->`;

  return (
    <BlockFrame
      emitter={emitter}
      padding={p.padding}
      backgroundColor={null}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      <Raw html={vml} emitter={emitter} />
      <Raw html={tableHtml} emitter={emitter} />
    </BlockFrame>
  );
}
