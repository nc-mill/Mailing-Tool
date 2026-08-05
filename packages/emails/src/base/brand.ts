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

/**
 * Převod zápisu písma z profilu značky na náš identifikátor.
 *
 * POŘADÍ JE SOUČÁST CHOVÁNÍ, ne kosmetika. Konkrétní názvy písem musí stát
 * PŘED obecnými rodinami (`serif`, `mono`), protože zápis z prohlížeče je
 * skoro vždy seznam, který obojí míchá: `Arial, Helvetica, sans-serif`.
 *
 * NAMĚŘENÁ VADA, kvůli které tenhle komentář vznikl: vzorek `/times|serif/i`
 * stál druhý a `serif` je částí slova `sans-serif`, takže úplně běžný
 * bezpatkový zápis `Arial, Helvetica, sans-serif` se mapoval na **Times New
 * Roman**. Uživatel si v nastavení značky zvolil Arial a v e-mailu dostal
 * patkové písmo, aniž by měl jak zjistit proč.
 *
 * Proto dvě opatření naráz, obě nutná:
 *  1. konkrétní písma napřed, obecné rodiny až nakonec,
 *  2. `serif` se nesmí chytit uvnitř `sans-serif`; hlídá to pohled dozadu.
 *     Bez něj by samotný zápis `sans-serif` bez konkrétního písma spadl
 *     na patkové, tedy na pravý opak toho, co říká.
 *
 * Co se sem NEVEJDE, spadne na `system`, a to je správně: vlastní webové
 * písmo poštovní klienti stejně nenačtou.
 */
const SPECIFIC_HINTS: Array<[RegExp, FontStackId]> = [
  [/georgia/i, 'georgia'],
  [/times/i, 'times'],
  [/courier/i, 'courier'],
  [/verdana/i, 'verdana'],
  [/tahoma|segoe/i, 'tahoma'],
  [/trebuchet/i, 'trebuchet'],
  [/helvetica/i, 'helvetica'],
  [/arial/i, 'arial'],
];

/** Poslední záchrana, když v zápisu není ani jedno konkrétní písmo. */
const GENERIC_HINTS: Array<[RegExp, FontStackId]> = [
  [/(?<!sans-)serif/i, 'times'],
  [/mono/i, 'courier'],
];

const RADII: Radius[] = [0, 4, 6, 8, 12];

/**
 * Rozhoduje POŘADÍ V ZÁPISU, ne pořadí v našem výčtu.
 *
 * Zápis `Arial, Helvetica, sans-serif` znamená „nejdřív Arial, když nebude,
 * tak Helvetica". Když se bere první vzorek z našeho seznamu, který někam sedne,
 * vyhraje písmo podle toho, jak jsme si výčet seřadili my, tedy Helvetica.
 * Uživatel zvolil Arial a dostal jiné písmo, jen o stupeň méně nápadně než
 * u toho patkového.
 *
 * Vybírá se proto shoda s NEJMENŠÍM indexem v zadaném řetězci. Obecné rodiny
 * (`serif`, `mono`) se zkoušejí až tehdy, když v zápisu není žádné konkrétní
 * písmo, protože v seznamu stojí naposled schválně jako poslední záchrana.
 */
function mapStack(value: string): FontStackId {
  let best: { id: FontStackId; at: number } | null = null;

  for (const [pattern, id] of SPECIFIC_HINTS) {
    const at = value.search(pattern);
    if (at !== -1 && (best === null || at < best.at)) best = { id, at };
  }
  if (best !== null) return best.id;

  for (const [pattern, id] of GENERIC_HINTS) if (pattern.test(value)) return id;
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
