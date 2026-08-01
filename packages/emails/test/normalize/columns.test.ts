import { describe, expect, it } from 'vitest';
import { COLUMN_RATIOS, columnWidths } from '../../src/normalize/columns';

describe('columnWidths', () => {
  it('splits a 600px section without padding evenly', () => {
    expect(columnWidths('1-1', 0, 600)).toEqual([300, 300]);
  });

  it('subtracts the gap before applying ratios', () => {
    expect(columnWidths('1-1', 16, 600)).toEqual([292, 292]);
  });

  it('gives the remainder to the last column so the sum is exact', () => {
    const widths = columnWidths('1-1-1', 16, 600);
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, b) => a + b, 0) + 32).toBe(600);
  });

  it('applies the documented ratios', () => {
    expect(columnWidths('1-2', 0, 600)).toEqual([200, 400]);
    expect(columnWidths('2-1', 0, 600)).toEqual([400, 200]);
    expect(columnWidths('2-1-1', 0, 600)).toEqual([300, 150, 150]);
    expect(columnWidths('1-1-2', 0, 600)).toEqual([150, 150, 300]);
  });

  it('never returns a width below one pixel', () => {
    expect(columnWidths('1-1-1', 48, 200).every((w) => w >= 1)).toBe(true);
  });

  it('declares two or three ratios for every layout', () => {
    for (const [layout, ratios] of Object.entries(COLUMN_RATIOS)) {
      expect(ratios.length, layout).toBeGreaterThanOrEqual(2);
      expect(ratios.length, layout).toBeLessThanOrEqual(3);
    }
  });
});
