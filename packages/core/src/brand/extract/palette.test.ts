import { describe, expect, it } from 'vitest';
import { FALLBACK_PALETTE, buildPalette, contrastRatio } from './palette';

const candidate = (hex: string, weight: 'high' | 'medium' | 'low' = 'high') => ({
  hex,
  weight,
  source: 'css-var' as const,
  occurrences: 1,
});

describe('kontrast', () => {
  it('bílá na černé má poměr 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('stejné barvy mají poměr 1', () => {
    expect(contrastRatio('#c41e3a', '#c41e3a')).toBeCloseTo(1, 3);
  });
});

describe('sestavení palety', () => {
  it('primární je nejsilnější kandidát s dostatečnou sytostí a světlostí', () => {
    const palette = buildPalette([candidate('#c41e3a'), candidate('#eeeeee', 'low')]);
    expect(palette.primary).toBe('#c41e3a');
    expect(palette.source.primary).toBe('css-var');
  });

  it('když žádný kandidát nevyhoví, vezme se nejsytější a upraví se mu světlost', () => {
    const palette = buildPalette([candidate('#fffce0'), candidate('#fffde8')]);
    expect(palette.primary).not.toBe('#fffce0');
  });

  it('web bez jediné barvy dostane výchozí paletu se zdrojem fallback', () => {
    const palette = buildPalette([]);
    expect(palette).toMatchObject({
      primary: FALLBACK_PALETTE.primary,
      background: FALLBACK_PALETTE.background,
      text: FALLBACK_PALETTE.text,
    });
    expect(Object.values(palette.source).every((source) => source === 'fallback')).toBe(true);
  });

  it('sekundární má odstup odstínu aspoň 25 stupňů, jinak se odvodí z primární', () => {
    const palette = buildPalette([candidate('#c41e3a'), candidate('#c62240')]);
    expect(palette.secondary).not.toBe('#c62240');
  });

  it('doplňková má odstup aspoň 90 stupňů, jinak je rovna primární', () => {
    const palette = buildPalette([candidate('#c41e3a')]);
    expect(palette.accent).toBe(palette.primary);
  });

  it('kritérium 55: dvacet reálných palet, včetně žluté a světle zelené, má kontrast aspoň 4,5:1', () => {
    const brands = [
      '#c41e3a',
      '#ffd400',
      '#a8e10c',
      '#0057b8',
      '#ff6f00',
      '#7b1fa2',
      '#00897b',
      '#f50057',
      '#5d4037',
      '#455a64',
      '#fdd835',
      '#c0ca33',
      '#26c6da',
      '#8d6e63',
      '#ec407a',
      '#66bb6a',
      '#ffee58',
      '#d4e157',
      '#29b6f6',
      '#ab47bc',
    ];
    for (const hex of brands) {
      const palette = buildPalette([candidate(hex)]);
      expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
      // Text na primární barvě musí být čitelný aspoň v jednom směru.
      const light = contrastRatio('#ffffff', palette.primary);
      const dark = contrastRatio('#111827', palette.primary);
      expect(Math.max(light, dark)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dominantní barvy loga se použijí, když CSS nic nedalo', () => {
    const palette = buildPalette([], { logoColors: ['#0057b8'] });
    expect(palette.primary).toBe('#0057b8');
    expect(palette.source.primary).toBe('logo');
  });
});
