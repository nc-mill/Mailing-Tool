import { describe, expect, it } from 'vitest';
import { DEFAULT_DARK, DEFAULT_LIGHT, FONT_STACKS, contrastRatio } from '../../src/theme/palette';

describe('default palette', () => {
  it('defines all ten roles in both schemes', () => {
    const roles = Object.keys(DEFAULT_LIGHT).sort();
    expect(roles).toHaveLength(10);
    expect(Object.keys(DEFAULT_DARK).sort()).toEqual(roles);
  });

  it('matches the normative table in 3.1.4', () => {
    expect(DEFAULT_LIGHT['brand.primary']).toBe('#2563eb');
    expect(DEFAULT_LIGHT['text.default']).toBe('#111827');
    expect(DEFAULT_LIGHT['surface.canvas']).toBe('#f4f5f7');
    expect(DEFAULT_LIGHT['link.default']).toBe('#1d4ed8');
    expect(DEFAULT_DARK['surface.content']).toBe('#111827');
    expect(DEFAULT_DARK['text.default']).toBe('#e5e7eb');
    expect(DEFAULT_DARK['link.default']).toBe('#93c5fd');
  });

  it('keeps default text on default content above WCAG AA', () => {
    expect(
      contrastRatio(DEFAULT_LIGHT['text.default'], DEFAULT_LIGHT['surface.content']),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(DEFAULT_DARK['text.default'], DEFAULT_DARK['surface.content']),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('has a closed list of nine font stacks and resolves system to Segoe UI for Word', () => {
    expect(Object.keys(FONT_STACKS)).toHaveLength(9);
    expect(FONT_STACKS.system).toContain('"Segoe UI"');
    expect(FONT_STACKS.georgia).toBe('Georgia, "Times New Roman", serif');
  });
});
