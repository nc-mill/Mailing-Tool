import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/theme/palette';
import { brandToTheme, type BrandInput } from '../../src/base/brand';
import { plainToRichText } from '../../src/base/rich';

const brand = (over: Partial<BrandInput> = {}): BrandInput => ({
  palette: { primary: '#2563eb', background: '#ffffff', text: '#111827' },
  typography: { headingStack: 'Georgia', bodyStack: 'Arial', radius: 7 },
  ...over,
});

describe('brandToTheme', () => {
  it('maps the palette onto theme roles', () => {
    const theme = brandToTheme(
      brand({ palette: { primary: '#ff0000', background: '#eeeeee', text: '#222222' } }),
    );
    expect(theme.colors['brand.primary']).toBe('#ff0000');
    expect(theme.colors['surface.canvas']).toBe('#eeeeee');
    expect(theme.colors['surface.content']).toBe('#ffffff');
    expect(theme.colors['text.default']).toBe('#222222');
  });

  it('keeps button text readable on a light yellow brand colour', () => {
    const theme = brandToTheme(
      brand({ palette: { primary: '#ffee00', background: '#ffffff', text: '#111111' } }),
    );
    expect(contrastRatio(theme.colors['text.inverted']!, '#ffee00')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps link colour readable against the content surface', () => {
    const theme = brandToTheme(
      brand({ palette: { primary: '#ffee00', background: '#ffffff', text: '#111111' } }),
    );
    expect(contrastRatio(theme.colors['link.default']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('maps font stacks onto the closed list and falls back to system', () => {
    expect(brandToTheme(brand()).fonts).toEqual({ heading: 'georgia', body: 'arial' });
    expect(
      brandToTheme(
        brand({ typography: { headingStack: 'Futura', bodyStack: 'Futura', radius: 0 } }),
      ).fonts,
    ).toEqual({ heading: 'system', body: 'system' });
  });

  it('rounds the radius onto an allowed value', () => {
    expect(brandToTheme(brand()).radius).toBe(6);
    expect(
      brandToTheme(brand({ typography: { headingStack: '', bodyStack: '', radius: 30 } })).radius,
    ).toBe(12);
  });

  it('derives a secondary colour when the brand has none', () => {
    const theme = brandToTheme(brand());
    expect(theme.colors['brand.secondary']).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.colors['brand.secondary']).not.toBe(theme.colors['brand.primary']);
  });
});

describe('plainToRichText', () => {
  it('splits paragraphs on a blank line', () => {
    expect(plainToRichText('a\n\nb')).toEqual([
      { t: 'p', children: [{ t: 's', v: 'a' }] },
      { t: 'p', children: [{ t: 's', v: 'b' }] },
    ]);
  });

  it('turns a liquid expression into a var node so no html can ever get in', () => {
    expect(plainToRichText('Ahoj {{ contact.greeting }}!')).toEqual([
      {
        t: 'p',
        children: [
          { t: 's', v: 'Ahoj ' },
          { t: 'var', expr: 'contact.greeting' },
          { t: 's', v: '!' },
        ],
      },
    ]);
  });

  it('keeps html markup as plain text, never as markup', () => {
    expect(plainToRichText('<b>x</b>')).toEqual([
      { t: 'p', children: [{ t: 's', v: '<b>x</b>' }] },
    ]);
  });

  it('returns one empty paragraph for empty input', () => {
    expect(plainToRichText('')).toEqual([{ t: 'p', children: [] }]);
  });
});
