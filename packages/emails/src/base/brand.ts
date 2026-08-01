import type { FontStackId, HexColor, Radius, Theme } from '../document/types';
import { contrastRatio, DEFAULT_LIGHT, shift } from '../theme/palette';
import { DEFAULT_THEME } from '../document/defaults';

export type BrandInput = {
  palette: {
    primary: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  typography: { headingStack: string; bodyStack: string; radius: number };
};

const STACK_HINTS: Array<[RegExp, FontStackId]> = [
  [/georgia/i, 'georgia'],
  [/times|serif/i, 'times'],
  [/courier|mono/i, 'courier'],
  [/verdana/i, 'verdana'],
  [/tahoma|segoe/i, 'tahoma'],
  [/trebuchet/i, 'trebuchet'],
  [/helvetica/i, 'helvetica'],
  [/arial/i, 'arial'],
];

const RADII: Radius[] = [0, 4, 6, 8, 12];

function mapStack(value: string): FontStackId {
  for (const [pattern, id] of STACK_HINTS) if (pattern.test(value)) return id;
  return 'system';
}

/** Vybere z dvojice tu barvu, která má proti pozadí větší kontrast. */
function readableOn(background: string, candidates: HexColor[]): HexColor {
  let best = candidates[0]!;
  let bestRatio = contrastRatio(best, background);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Ztmavuje po krocích, dokud barva nedosáhne požadovaného kontrastu. */
function darkenUntil(color: string, background: string, target = 4.5): HexColor {
  let current = color as HexColor;
  for (let step = 0; step < 20; step += 1) {
    if (contrastRatio(current, background) >= target) return current;
    current = shift(current, -0.1);
  }
  return current;
}

export function brandToTheme(brand: BrandInput): Theme {
  const primary = brand.palette.primary as HexColor;
  const canvas = (brand.palette.background ?? DEFAULT_LIGHT['surface.canvas']) as HexColor;
  const content: HexColor = '#ffffff';
  const text = (brand.palette.text ?? DEFAULT_LIGHT['text.default']) as HexColor;
  const secondary = brand.palette.secondary;
  const accent = brand.palette.accent;

  return {
    ...DEFAULT_THEME,
    colors: {
      'brand.primary': primary,
      'brand.secondary': secondary ? (secondary as HexColor) : shift(primary, 0.25),
      'brand.accent': accent ? (accent as HexColor) : primary,
      'surface.canvas': canvas,
      'surface.content': content,
      'surface.subtle': shift(canvas, -0.05),
      'text.default': text,
      'text.muted': shift(text, 0.35),
      // Text na tlačítku: bílá nebo tmavá, podle toho, co je na primární barvě čitelné.
      'text.inverted': readableOn(primary, ['#ffffff', '#111827']),
      'link.default': darkenUntil(primary, content),
    },
    fonts: {
      heading: mapStack(brand.typography.headingStack),
      body: mapStack(brand.typography.bodyStack),
    },
    radius: RADII.reduce(
      (best, value) =>
        Math.abs(value - brand.typography.radius) < Math.abs(best - brand.typography.radius)
          ? value
          : best,
      RADII[0]!,
    ),
  };
}
