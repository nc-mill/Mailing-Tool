import postcss from 'postcss';

export type ColorWeight = 'high' | 'medium' | 'low';
export type ColorSource = 'meta' | 'css-var' | 'css-selector' | 'css-freq' | 'logo' | 'fallback';

export type ColorCandidate = {
  hex: string;
  weight: ColorWeight;
  source: ColorSource;
  occurrences: number;
};

const BRAND_VAR_PATTERN = /(^|-)(brand|primary|accent|main|theme)(-|$)/i;
const BRAND_SELECTOR_PATTERN = /(btn|button|cta|primary|header|nav)/i;
const HEX_PATTERN = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
const RGB_PATTERN = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;

const WEIGHT_RANK: Record<ColorWeight, number> = { high: 3, medium: 2, low: 1 };

function expandHex(hex: string): string {
  const body = hex.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function colorsIn(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(HEX_PATTERN)) found.push(expandHex(match[0]));
  for (const match of value.matchAll(RGB_PATTERN)) {
    found.push(toHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  return found;
}

/**
 * Zdroje barev v pořadí z 3.13.10. Explicitní tvrzení o barvě značky
 * (`theme-color`, custom property s brandovým názvem) váží víc než barva,
 * kterou jsme jen našli často.
 */
export function collectColorCandidates(
  css: string,
  options: { themeColor?: string | undefined } = {},
): ColorCandidate[] {
  const map = new Map<string, ColorCandidate>();

  const add = (hex: string, weight: ColorWeight, source: ColorSource) => {
    const existing = map.get(hex);
    if (existing === undefined) {
      map.set(hex, { hex, weight, source, occurrences: 1 });
      return;
    }
    existing.occurrences += 1;
    if (WEIGHT_RANK[weight] > WEIGHT_RANK[existing.weight]) {
      existing.weight = weight;
      existing.source = source;
    }
  };

  if (options.themeColor !== undefined) {
    for (const hex of colorsIn(options.themeColor)) add(hex, 'high', 'meta');
  }

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    // Nesrozumitelné CSS není důvod shodit extrakci.
    return [...map.values()];
  }

  root.walkDecls((decl) => {
    const values = colorsIn(decl.value);
    if (values.length === 0) return;

    if (decl.prop.startsWith('--') && BRAND_VAR_PATTERN.test(decl.prop)) {
      for (const hex of values) add(hex, 'high', 'css-var');
      return;
    }

    const selector = (decl.parent as postcss.Rule | undefined)?.selector ?? '';
    if (BRAND_SELECTOR_PATTERN.test(selector)) {
      for (const hex of values) add(hex, 'medium', 'css-selector');
      return;
    }

    for (const hex of values) add(hex, 'low', 'css-freq');
  });

  return [...map.values()].sort((a, b) => {
    if (WEIGHT_RANK[b.weight] !== WEIGHT_RANK[a.weight]) {
      return WEIGHT_RANK[b.weight] - WEIGHT_RANK[a.weight];
    }
    return b.occurrences - a.occurrences;
  });
}

const FONT_FAMILY_PATTERN = /font-family/i;
const RADIUS_PATTERN = /border-radius/i;

/** Deklarované rodiny písma a poloměry zaoblení, v pořadí výskytu. */
export function collectTypographyCandidates(css: string): {
  fontFamilies: string[];
  radii: string[];
} {
  const fontFamilies: string[] = [];
  const radii: string[] = [];

  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return { fontFamilies, radii };
  }

  root.walkDecls((decl) => {
    if (FONT_FAMILY_PATTERN.test(decl.prop)) fontFamilies.push(decl.value);
    if (RADIUS_PATTERN.test(decl.prop)) radii.push(decl.value);
  });

  return { fontFamilies, radii };
}
