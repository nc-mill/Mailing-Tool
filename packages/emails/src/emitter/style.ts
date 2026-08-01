import type { CSSProperties } from 'react';
import type { Padding } from '../document/types';

export const px = (value: number): string => `${Math.round(value)}px`;

export function paddingStyle(padding: Padding): CSSProperties {
  return {
    paddingTop: px(padding.top),
    paddingRight: px(padding.right),
    paddingBottom: px(padding.bottom),
    paddingLeft: px(padding.left),
  };
}

/**
 * Řádkování se vždy uvádí v pixelech a doplňuje se mso-line-height-rule.
 * Bez toho počítá Word engine řádkování jinak než ostatní klienti a text se rozjede.
 * React převede klíč `msoLineHeightRule` na `mso-line-height-rule`.
 */
export function lineHeightStyle(fontSize: number, lineHeight: number): CSSProperties {
  return {
    lineHeight: px(fontSize * lineHeight),
    msoLineHeightRule: 'exactly',
  } as CSSProperties;
}

export const ALIGN_TO_TEXT_ALIGN = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
} as const;
