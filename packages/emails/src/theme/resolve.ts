import type { ColorRef, HexColor, RoleColorMap, Theme, ThemeColorRole } from '../document/types';
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

/**
 * Rolí je deset, takže víc než deset skoků znamená kruh. Pojistka je tu i tak:
 * počet rolí smí verze schématu zvětšit, kdežto tenhle cyklus musí skončit vždy.
 */
const ALIAS_LIMIT = 10;

/**
 * Rozváže jednu roli až na odstín.
 *
 * Motiv smí místo odstínu nést JMÉNO JINÉ ROLE („pozadí plátna = hlavní barva
 * značky"). Je to vazba, ne kopie: po změně značky se přebarví i to, co na ni
 * ukazuje. Do e-mailu ale žádné jméno role odejít nesmí, jinak by se v HTML
 * objevil text `brand.primary` místo barvy.
 *
 * KRUH SE NEDÁ VYLOUČIT vstupem: dokument přichází ze souboru a schéma sousedské
 * odkazy nekontroluje, takže „plátno ukazuje na obsah, obsah na plátno" musí
 * projít. Skončí to výchozím odstínem té role, ne zacyklením ani prázdnou
 * barvou. Totéž u role, která ukazuje na sebe.
 */
function resolveRole(
  base: Record<ThemeColorRole, HexColor>,
  raw: Record<ThemeColorRole, ColorRef>,
  role: ThemeColorRole,
): HexColor {
  const seen = new Set<ThemeColorRole>([role]);
  let current: ColorRef | undefined = raw[role];
  for (let step = 0; step < ALIAS_LIMIT; step += 1) {
    if (current === undefined) break;
    if (current.startsWith('#')) return current as HexColor;
    const next = current as ThemeColorRole;
    if (seen.has(next)) break;
    seen.add(next);
    current = raw[next];
  }
  return base[role];
}

function scheme(base: Record<ThemeColorRole, HexColor>, overrides: RoleColorMap): ResolvedScheme {
  const raw = { ...base, ...overrides } as Record<ThemeColorRole, ColorRef>;
  const roles = {} as Record<ThemeColorRole, HexColor>;
  for (const role of Object.keys(raw) as ThemeColorRole[]) {
    roles[role] = resolveRole(base, raw, role);
  }
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
