import { describe, expect, it } from 'vitest';
import { fieldUsage } from './field-usage';

describe('fieldUsage', () => {
  it('spočítá využití obou limitů zvlášť', () => {
    expect(
      fieldUsage({
        fields: [
          { id: '1', indexed: true, archived: false },
          { id: '2', indexed: false, archived: false },
          { id: '3', indexed: false, archived: true },
        ],
        limits: { fields: 100, indexed: 8 },
      }),
    ).toEqual({
      used: 2,
      limit: 100,
      indexedUsed: 1,
      indexedLimit: 8,
      atLimit: false,
      atIndexedLimit: false,
    });
  });

  it('archivované pole se do limitu nepočítá, protože ho jde znovu zapnout', () => {
    const usage = fieldUsage({
      fields: Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        indexed: false,
        archived: index < 5,
      })),
      limits: { fields: 100, indexed: 8 },
    });
    expect(usage.used).toBe(95);
    expect(usage.atLimit).toBe(false);
  });

  it('na stropu polí to hlásí dřív, než uživatel klikne na přidat', () => {
    const usage = fieldUsage({
      fields: Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        indexed: false,
        archived: false,
      })),
      limits: { fields: 100, indexed: 8 },
    });
    expect(usage.atLimit).toBe(true);
  });

  it('na stropu indexovaných polí to hlásí zvlášť', () => {
    const usage = fieldUsage({
      fields: Array.from({ length: 8 }, (_, index) => ({
        id: String(index),
        indexed: true,
        archived: false,
      })),
      limits: { fields: 100, indexed: 8 },
    });
    expect(usage.atIndexedLimit).toBe(true);
    expect(usage.atLimit).toBe(false);
  });
});
