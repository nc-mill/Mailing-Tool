import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Theme } from '@mlain/emails/document/types';
import { brandThemeParts } from './theme';

/**
 * Pravidlo, podle kterého se rozhoduje při ZAKLÁDÁNÍ dokumentu i při jeho
 * PŘEVLÉKÁNÍ do nové značky. Je jedno na obou místech, takže rozhoduje o tom,
 * co uživatel uvidí, a stojí za to mít ho pokryté zvlášť.
 *
 * Zkráceně: převezmi hodnotu ze značky jen tam, kde dokument pořád drží to,
 * co by dala značka předchozí, nebo výchozí hodnotu.
 */
describe('brandThemeParts', () => {
  const theme = (over: Partial<Theme> = {}): Theme => ({ ...DEFAULT_THEME, ...over });

  const znacka = (over: Partial<Theme> = {}): Theme =>
    theme({
      colors: {
        'brand.primary': '#d324eb',
        'surface.canvas': '#f4f5f7',
        'text.default': '#111827',
      },
      fonts: { heading: 'georgia', body: 'arial' },
      radius: 12,
      ...over,
    });

  it('nedotčený dokument dostane barvy, písmo i rádius ze značky', () => {
    const parts = brandThemeParts(DEFAULT_THEME, znacka(), null);
    expect(parts.colors['brand.primary']).toBe('#d324eb');
    expect(parts.fonts).toEqual({ heading: 'georgia', body: 'arial' });
    expect(parts.radius).toBe(12);
  });

  /**
   * PŘESNĚ TEN PŘÍPAD, kvůli kterému pravidlo přestalo být „všechno nebo nic".
   * Panel motivu píše „Pozadí plátna" rovnou do `theme.colors`, takže jedno
   * kliknutí dřív zablokovalo doplnění značky u všech ostatních rolí.
   */
  it('vlastní pozadí plátna nezablokuje doplnění zbylých rolí', () => {
    const vlastni = theme({ colors: { 'surface.canvas': '#101010' } });
    const parts = brandThemeParts(vlastni, znacka(), null);

    expect(parts.colors['surface.canvas']).toBe('#101010');
    expect(parts.colors['brand.primary']).toBe('#d324eb');
    expect(parts.colors['text.default']).toBe('#111827');
  });

  it('barvu z předchozí značky převezme, ručně zvolenou nechá být', () => {
    const stara = znacka({ colors: { 'brand.primary': '#0d7a3f', 'surface.canvas': '#eeeeee' } });
    const dokument = theme({ colors: { 'brand.primary': '#0d7a3f', 'surface.canvas': '#101010' } });

    const parts = brandThemeParts(dokument, znacka(), stara);

    // Držel hodnotu staré značky, takže se převleče.
    expect(parts.colors['brand.primary']).toBe('#d324eb');
    // Tuhle si zvolil člověk, ta zůstává.
    expect(parts.colors['surface.canvas']).toBe('#101010');
  });

  it('roli s výchozí hodnotou z palety bere jako zděděnou', () => {
    // `#2563eb` je `brand.primary` z DEFAULT_LIGHT, tedy hodnota, kterou by
    // dokument dostal i bez zápisu.
    const dokument = theme({ colors: { 'brand.primary': '#2563eb' } });
    expect(brandThemeParts(dokument, znacka(), null).colors['brand.primary']).toBe('#d324eb');
  });

  it('ručně nastavené písmo a rádius zůstanou', () => {
    const dokument = theme({ fonts: { heading: 'courier', body: 'courier' }, radius: 4 });
    const parts = brandThemeParts(dokument, znacka(), null);

    expect(parts.fonts).toEqual({ heading: 'courier', body: 'courier' });
    expect(parts.radius).toBe(4);
    // Barvy dostane i tak: písmo a barva jsou dvě různá rozhodnutí.
    expect(parts.colors['brand.primary']).toBe('#d324eb');
  });

  it('písmo z předchozí značky se převezme', () => {
    const stara = znacka({ fonts: { heading: 'verdana', body: 'verdana' } });
    const dokument = theme({ fonts: { heading: 'verdana', body: 'verdana' } });

    expect(brandThemeParts(dokument, znacka(), stara).fonts).toEqual({
      heading: 'georgia',
      body: 'arial',
    });
  });

  /**
   * Šířka obsahu ani velikost písma nejsou rozhodnutí o značce. Kdo si rozšířil
   * obsah na 640, o barvu značky přijít nemá, a naopak se mu šířka nemá vrátit
   * na výchozí hodnotu.
   */
  it('vrací jen tři klíče, o kterých značka rozhoduje', () => {
    const parts = brandThemeParts(theme({ contentWidth: 640 }), znacka(), null);
    expect(Object.keys(parts).sort()).toEqual(['colors', 'fonts', 'radius']);
  });
});
