import type { ColorRef, HexColor, Theme, ThemeColorRole } from '../document/types';
import { DEFAULT_DARK, DEFAULT_LIGHT, FONT_STACKS } from './palette';

export type ResolvedScheme = {
  roles: Record<ThemeColorRole, HexColor>;
  color: (ref: ColorRef) => HexColor;
};

export type ResolvedTheme = {
  contentWidth: number;
  radius: number;
  baseFontSize: number;
  baseLineHeight: number;
  headingScale: number;
  fonts: { heading: string; body: string };
  light: ResolvedScheme;
  dark: ResolvedScheme;
  darkModeEnabled: boolean;
  headingSize: (level: 1 | 2 | 3) => number;
  mobile: {
    breakpoint: number;
    pad: number;
    headingSize: (level: 1 | 2 | 3) => number;
    headingLineHeight: number;
  };
};

function scheme(
  base: Record<ThemeColorRole, HexColor>,
  overrides: Partial<Record<ThemeColorRole, HexColor>>,
): ResolvedScheme {
  const roles = { ...base, ...overrides } as Record<ThemeColorRole, HexColor>;
  return {
    roles,
    color: (ref: ColorRef): HexColor =>
      ref.startsWith('#') ? (ref as HexColor) : roles[ref as ThemeColorRole],
  };
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  const light = scheme(DEFAULT_LIGHT, theme.colors);
  const dark = scheme(DEFAULT_DARK, theme.darkMode.colors);
  const { baseFontSize, baseLineHeight, headingScale } = theme.typography;

  // Odvozené velikosti nadpisů (3.2.4). Normativní je tabulka hodnot
  // 31 px, 25 px a 20 px pro baseFontSize 16 a headingScale 1.25, ne slovo
  // "nahoru": `Math.ceil(16 × 1.25³) = Math.ceil(31.25)` je 32, ne 31, takže
  // by úroveň 1 tabulce neseděla a mobilní velikost by vyšla 27 místo 26.
  const headingSize = (level: 1 | 2 | 3): number =>
    Math.round(baseFontSize * headingScale ** (4 - level));

  // Mobilní hodnoty se odvozují z motivu, nikdy nejsou konstanty (3.4.3).
  const mobileHeadingSize = (level: 1 | 2 | 3): number =>
    Math.max(baseFontSize + 4, Math.round(headingSize(level) * 0.84));

  return {
    contentWidth: theme.contentWidth,
    radius: theme.radius,
    baseFontSize,
    baseLineHeight,
    headingScale,
    fonts: { heading: FONT_STACKS[theme.fonts.heading], body: FONT_STACKS[theme.fonts.body] },
    light,
    dark,
    darkModeEnabled: theme.darkMode.strategy === 'auto',
    headingSize,
    mobile: {
      breakpoint: theme.contentWidth,
      pad: Math.min(24, Math.max(12, Math.round(baseFontSize))),
      headingSize: mobileHeadingSize,
      headingLineHeight: Math.max(1.15, Math.round((baseLineHeight - 0.3) * 100) / 100),
    },
  };
}
