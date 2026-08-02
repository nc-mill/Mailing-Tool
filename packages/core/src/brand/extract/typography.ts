export type FontStackId = 'system' | 'georgia' | 'arial' | 'verdana' | 'tahoma' | 'courier';

export type BrandTypography = {
  headingStack: FontStackId;
  bodyStack: FontStackId;
  radius: number;
};

/** Povolené hodnoty zaoblení podle motivu blokového modelu. */
export const ALLOWED_RADII = [0, 2, 4, 6, 8, 12, 16] as const;

const SERIF_FONTS = new Set([
  'georgia',
  'merriweather',
  'playfair',
  'playfair display',
  'times',
  'times new roman',
  'lora',
  'pt serif',
  'source serif pro',
  'crimson text',
]);
const MONO_FONTS = new Set(['courier', 'courier new', 'source code pro', 'jetbrains mono']);
const VERDANA_FONTS = new Set(['verdana', 'geneva']);
const TAHOMA_FONTS = new Set(['tahoma', 'segoe ui']);
const ARIAL_FONTS = new Set(['arial', 'helvetica', 'helvetica neue']);

const PX_VALUE = /^(\d+(?:\.\d+)?)px$/;

/**
 * V e-mailech používáme jen písma, která má každý v počítači. Neznámé jméno
 * padá na `system`; uživatel to v UI uvidí i s vysvětlením, protože zákazník
 * s brand manuálem bude své firemní písmo čekat.
 */
export function mapFontStack(fontFamily: string | undefined): FontStackId {
  if (fontFamily === undefined || fontFamily.trim() === '') return 'system';
  const first = (fontFamily.split(',')[0] ?? '')
    .trim()
    .replaceAll('"', '')
    .replaceAll("'", '')
    .toLowerCase();
  if (SERIF_FONTS.has(first)) return 'georgia';
  if (MONO_FONTS.has(first)) return 'courier';
  if (VERDANA_FONTS.has(first)) return 'verdana';
  if (TAHOMA_FONTS.has(first)) return 'tahoma';
  if (ARIAL_FONTS.has(first)) return 'arial';
  return 'system';
}

export function medianRadius(values: readonly string[]): number {
  const pixels = values
    .map((value) => value.trim().match(PX_VALUE)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);

  const middle = pixels[Math.floor(pixels.length / 2)];
  if (middle === undefined) return 6;
  // Neostrá nerovnost schválně: při shodné vzdálenosti (3 px leží mezi 2 a 4)
  // vyhrává vyšší hodnota. Zaoblení dolů vypadá jako chyba sazby, nahoru ne.
  return ALLOWED_RADII.reduce<number>(
    (best, allowed) => (Math.abs(allowed - middle) <= Math.abs(best - middle) ? allowed : best),
    ALLOWED_RADII[0],
  );
}
