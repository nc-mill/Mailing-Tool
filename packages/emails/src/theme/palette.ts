import { converter, wcagContrast } from 'culori';
import type { FontStackId, HexColor, ThemeColorRole } from '../document/types';

/** Výchozí role světlého režimu, normativní tabulka z 3.1.4. */
export const DEFAULT_LIGHT: Record<ThemeColorRole, HexColor> = {
  'brand.primary': '#2563eb',
  'brand.secondary': '#3b82f6',
  'brand.accent': '#2563eb',
  'text.default': '#111827',
  'text.muted': '#6b7280',
  'text.inverted': '#ffffff',
  'surface.canvas': '#f4f5f7',
  'surface.content': '#ffffff',
  'surface.subtle': '#e5e7eb',
  'link.default': '#1d4ed8',
};

export const DEFAULT_DARK: Record<ThemeColorRole, HexColor> = {
  'brand.primary': '#60a5fa',
  'brand.secondary': '#93c5fd',
  'brand.accent': '#60a5fa',
  'text.default': '#e5e7eb',
  'text.muted': '#9ca3af',
  'text.inverted': '#0b0f19',
  'surface.canvas': '#0b0f19',
  'surface.content': '#111827',
  'surface.subtle': '#1f2937',
  'link.default': '#93c5fd',
};

/**
 * Uzavřený seznam. Webfonty v e-mailu nepodporuje Outlook na Windows ani Gmail,
 * takže vlastní písmo je vždy jen kosmetika a fallback stejně musí být systémový.
 */
export const FONT_STACKS: Record<FontStackId, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, Segoe, sans-serif',
  trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

const toRgb = converter('rgb');

export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b);
}

/** Zesvětlení nebo ztmavení o daný podíl, používá base template při odvozování barev. */
export function shift(color: string, amount: number): HexColor {
  const rgb = toRgb(color);
  if (!rgb) return '#000000';
  const mix = (channel: number): number =>
    amount >= 0 ? channel + (1 - channel) * amount : channel * (1 + amount);
  const hex = (channel: number): string =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(mix(rgb.r))}${hex(mix(rgb.g))}${hex(mix(rgb.b))}`;
}
