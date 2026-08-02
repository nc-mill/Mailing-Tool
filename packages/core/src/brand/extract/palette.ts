import { converter, formatHex, wcagContrast } from 'culori';
import type { ColorCandidate, ColorSource } from './css';

const toOklch = converter('oklch');

export type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  source: Record<'primary' | 'secondary' | 'accent' | 'background' | 'text', ColorSource>;
};

export const FALLBACK_PALETTE = {
  primary: '#2563eb',
  secondary: '#3b82f6',
  accent: '#2563eb',
  background: '#f4f5f7',
  text: '#111827',
} as const;

export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b);
}

const chromaOf = (hex: string): number => toOklch(hex)?.c ?? 0;
const lightnessOf = (hex: string): number => toOklch(hex)?.l ?? 0;
const hueOf = (hex: string): number => toOklch(hex)?.h ?? 0;

function withLightness(hex: string, lightness: number): string {
  const color = toOklch(hex);
  if (color === undefined) return hex;
  return formatHex({ ...color, l: Math.max(0, Math.min(1, lightness)) }) ?? hex;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Světlá a tmavá barva písma, které se na primární barvu doopravdy sázejí. */
const ON_PRIMARY_LIGHT = '#ffffff';
const ON_PRIMARY_DARK = '#111827';

function bestOnPrimary(hex: string): number {
  return Math.max(contrastRatio(ON_PRIMARY_LIGHT, hex), contrastRatio(ON_PRIMARY_DARK, hex));
}

/**
 * DOPLNĚK PROTI PLÁNU, vynucený kritériem 55. Plán opravoval kontrast jen
 * u dvojice text a pozadí, ale primární barvu nechal tak, jak přišla z webu.
 * Naměřeno na seznamu dvaceti reálných značek: středně tmavé tóny `#00897b`
 * a `#f50057` nemají 4,5:1 ANI proti bílé, ANI proti tmavému textu (maximum
 * 4,32 a 4,24), takže by na tlačítku nebyl čitelný žádný nápis.
 *
 * Primární barva se proto posouvá po světlosti tím směrem, který už teď dává
 * lepší kontrast, dokud jeden ze dvou nápisů nepřekročí 4,5:1. Odstín ani
 * sytost se nemění, takže barva zůstane poznat.
 */
function ensureReadablePrimary(hex: string): string {
  if (bestOnPrimary(hex) >= 4.5) return hex;

  const step =
    contrastRatio(ON_PRIMARY_LIGHT, hex) >= contrastRatio(ON_PRIMARY_DARK, hex) ? -0.02 : 0.02;

  let current = hex;
  for (let guard = 0; guard < 50; guard += 1) {
    const lightness = lightnessOf(current) + step;
    if (lightness <= 0 || lightness >= 1) break;
    current = withLightness(current, lightness);
    if (bestOnPrimary(current) >= 4.5) return current;
  }
  return current;
}

/**
 * Výběr rolí podle 3.13.10 plus kontrola a oprava kontrastu podle 3.9.4.
 *
 * Klíčové pravidlo: generátor nikdy nevytvoří kombinaci, která nemá kontrast
 * aspoň 4,5:1. Výsledek je vždy použitelná paleta, i kdyby vstupní web byl
 * jednobarevný.
 */
export function buildPalette(
  candidates: readonly ColorCandidate[],
  options: { logoColors?: readonly string[] } = {},
): BrandPalette {
  const pool: Array<{ hex: string; source: ColorSource }> = [
    ...candidates.map((c) => ({ hex: c.hex, source: c.source })),
    ...(options.logoColors ?? []).map((hex) => ({ hex, source: 'logo' as ColorSource })),
  ];

  const source: BrandPalette['source'] = {
    primary: 'fallback',
    secondary: 'fallback',
    accent: 'fallback',
    background: 'fallback',
    text: 'fallback',
  };

  let primary: string = FALLBACK_PALETTE.primary;
  const strong = pool.find(
    (c) => chromaOf(c.hex) > 0.05 && lightnessOf(c.hex) >= 0.25 && lightnessOf(c.hex) <= 0.75,
  );
  if (strong !== undefined) {
    primary = strong.hex;
    source.primary = strong.source;
  } else {
    const sorted = [...pool].sort((a, b) => chromaOf(b.hex) - chromaOf(a.hex));
    const first = sorted[0];
    if (first !== undefined) {
      primary = withLightness(first.hex, 0.5);
      source.primary = first.source;
    }
  }

  // Oprava čitelnosti musí přijít PŘED odvozením ostatních rolí: sekundární
  // i doplňková se počítají z primární a musí vycházet z té skutečné.
  primary = ensureReadablePrimary(primary);

  let secondary = withLightness(primary, Math.min(0.95, lightnessOf(primary) + 0.15));
  const secondaryCandidate = pool.find(
    (c) => c.hex !== primary && hueDistance(hueOf(c.hex), hueOf(primary)) >= 25,
  );
  if (secondaryCandidate !== undefined) {
    secondary = secondaryCandidate.hex;
    source.secondary = secondaryCandidate.source;
  }

  let accent = primary;
  source.accent = source.primary;
  const accentCandidate = pool.find((c) => hueDistance(hueOf(c.hex), hueOf(primary)) >= 90);
  if (accentCandidate !== undefined) {
    accent = accentCandidate.hex;
    source.accent = accentCandidate.source;
  }

  let background: string = FALLBACK_PALETTE.background;
  const backgroundCandidate = pool
    .filter((c) => chromaOf(c.hex) < 0.03 && lightnessOf(c.hex) > 0.9)
    .sort((a, b) => lightnessOf(b.hex) - lightnessOf(a.hex))[0];
  if (backgroundCandidate !== undefined) {
    background = backgroundCandidate.hex;
    source.background = backgroundCandidate.source;
  }

  let text: string = FALLBACK_PALETTE.text;
  const textCandidate = pool
    .filter((c) => chromaOf(c.hex) < 0.03 && lightnessOf(c.hex) < 0.35)
    .sort((a, b) => lightnessOf(a.hex) - lightnessOf(b.hex))[0];
  if (textCandidate !== undefined) {
    text = textCandidate.hex;
    source.text = textCandidate.source;
  }

  // Kontrola a oprava kontrastu. Text se ztmavuje, dokud nedosáhne 4,5:1
  // proti pozadí. Tenhle krok je důvod, proč paleta z jednobarevného webu
  // pořád vypadá jako paleta.
  let guard = 0;
  while (contrastRatio(text, background) < 4.5 && guard < 40) {
    text = withLightness(text, Math.max(0, lightnessOf(text) - 0.025));
    guard += 1;
  }
  if (contrastRatio(text, background) < 4.5) text = '#000000';

  return { primary, secondary, accent, background, text, source };
}
