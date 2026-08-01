import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../src/document/defaults';
import { DEFAULT_DARK, DEFAULT_LIGHT } from '../../src/theme/palette';
import { resolveTheme } from '../../src/theme/resolve';

describe('resolveTheme', () => {
  it('fills every missing role from the defaults', () => {
    const resolved = resolveTheme({ ...DEFAULT_THEME, colors: { 'brand.primary': '#ff0000' } });
    expect(resolved.light.roles['brand.primary']).toBe('#ff0000');
    expect(resolved.light.roles['text.default']).toBe(DEFAULT_LIGHT['text.default']);
    expect(Object.keys(resolved.light.roles)).toHaveLength(10);
  });

  it('uses the dark defaults for the dark scheme unless overridden', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      darkMode: { strategy: 'auto', colors: { 'surface.content': '#123456' } },
    });
    expect(resolved.dark.roles['surface.content']).toBe('#123456');
    expect(resolved.dark.roles['text.default']).toBe(DEFAULT_DARK['text.default']);
  });

  it('resolves a literal hex reference to itself and a role reference to its value', () => {
    const resolved = resolveTheme(DEFAULT_THEME);
    expect(resolved.light.color('#abcdef')).toBe('#abcdef');
    expect(resolved.light.color('link.default')).toBe(DEFAULT_LIGHT['link.default']);
    expect(resolved.dark.color('link.default')).toBe(DEFAULT_DARK['link.default']);
  });

  it('maps font stack ids to css font families', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      fonts: { heading: 'georgia', body: 'arial' },
    });
    expect(resolved.fonts.heading).toBe('Georgia, "Times New Roman", serif');
    expect(resolved.fonts.body).toBe('Arial, Helvetica, sans-serif');
  });

  it('derives heading sizes from the scale and rounds up', () => {
    const resolved = resolveTheme(DEFAULT_THEME);
    expect(resolved.headingSize(1)).toBe(31);
    expect(resolved.headingSize(2)).toBe(25);
    expect(resolved.headingSize(3)).toBe(20);
  });

  it('derives mobile values from the theme, never from constants', () => {
    const base = resolveTheme(DEFAULT_THEME);
    expect(base.mobile.pad).toBe(16);
    expect(base.mobile.headingSize(1)).toBe(26);
    expect(base.mobile.headingLineHeight).toBeCloseTo(1.2, 5);
    const big = resolveTheme({
      ...DEFAULT_THEME,
      typography: { baseFontSize: 20, baseLineHeight: 1.5, headingScale: 1.25 },
    });
    expect(big.mobile.headingSize(1)).not.toBe(base.mobile.headingSize(1));
    expect(big.mobile.headingSize(1)).toBeGreaterThanOrEqual(24);
  });

  it('reports whether dark mode is on', () => {
    expect(resolveTheme(DEFAULT_THEME).darkModeEnabled).toBe(true);
    expect(
      resolveTheme({ ...DEFAULT_THEME, darkMode: { strategy: 'off', colors: {} } }).darkModeEnabled,
    ).toBe(false);
  });
});
