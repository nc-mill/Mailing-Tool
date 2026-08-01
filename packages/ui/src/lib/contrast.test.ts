import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

describe('contrastRatio', () => {
  it('bílá proti černé je 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });

  it('stejná barva je 1:1', () => {
    expect(contrastRatio('#1D4ED8', '#1D4ED8')).toBeCloseTo(1, 5);
  });

  it('je symetrický', () => {
    expect(contrastRatio('#4B5563', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#4B5563'),
      10,
    );
  });

  it('zvládne krátký zápis se třemi znaky', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });

  it('luminance bílé je 1 a černé 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });
});
