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

  /*
   * Vazba na jinou roli, ne kopie odstínu. Panel motivu tak zapisuje volbu
   * „pozadí plátna = hlavní barva značky": změna značky přepíše `brand.primary`
   * a plátno jde s ní. Do e-mailu přitom musí odejít hex, ne jméno role.
   */
  it('follows a role that points at another role', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      colors: { 'brand.primary': '#ff0000', 'surface.canvas': 'brand.primary' },
    });
    expect(resolved.light.roles['surface.canvas']).toBe('#ff0000');
    expect(resolved.light.color('surface.canvas')).toBe('#ff0000');
  });

  it('follows a chain of role references down to the hex', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      colors: {
        'brand.primary': '#0000ff',
        'brand.accent': 'brand.primary',
        'surface.canvas': 'brand.accent',
      },
    });
    expect(resolved.light.roles['surface.canvas']).toBe('#0000ff');
  });

  /*
   * Kruh přijde ze souboru, schéma ho nezachytí. Musí skončit výchozím
   * odstínem té role, ne zacyklením ani prázdnou barvou v HTML.
   */
  it('falls back to the default when roles point at each other in a circle', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      colors: { 'surface.canvas': 'surface.content', 'surface.content': 'surface.canvas' },
    });
    expect(resolved.light.roles['surface.canvas']).toBe(DEFAULT_LIGHT['surface.canvas']);
    expect(resolved.light.roles['surface.content']).toBe(DEFAULT_LIGHT['surface.content']);
  });

  it('falls back to the default when a role points at itself', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      colors: { 'surface.canvas': 'surface.canvas' },
    });
    expect(resolved.light.roles['surface.canvas']).toBe(DEFAULT_LIGHT['surface.canvas']);
  });

  it('resolves role references in the dark scheme against the dark palette', () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      darkMode: { strategy: 'auto', colors: { 'surface.canvas': 'brand.primary' } },
    });
    expect(resolved.dark.roles['surface.canvas']).toBe(DEFAULT_DARK['brand.primary']);
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
