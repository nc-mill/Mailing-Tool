import { describe, expect, it } from 'vitest';
import {
  CATALOG_UPDATED_AT,
  PRICING_UPDATED_AT,
  curatedModels,
  defaultModelFor,
  estimateCostUsd,
  priceFor,
} from './catalog';

describe('katalog modelů', () => {
  it('u anthropicu nabízí rodinu Claude 5 a Haiku 4.5', () => {
    const ids = curatedModels('anthropic').map((m) => m.id);
    expect(ids).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-haiku-4-5-20251001',
    ]);
  });

  it('výchozí model anthropicu je claude-opus-5', () => {
    expect(defaultModelFor('anthropic')).toBe('claude-opus-5');
  });

  it('u providerů se seznamovým endpointem kurátorovaný seznam prázdný být smí', () => {
    expect(curatedModels('openai_compatible')).toEqual([]);
  });

  it('katalog i ceník nesou datum, které jde zobrazit v UI', () => {
    expect(CATALOG_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRICING_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('cena se hledá podle dvojice provider a model', () => {
    expect(priceFor('anthropic', 'claude-opus-5')).toEqual({
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
    });
    expect(priceFor('anthropic', 'claude-haiku-4-5-20251001')).toEqual({
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 5,
    });
  });

  it('model mimo ceník vrátí null, ne nulu ani odhad', () => {
    expect(priceFor('openai', 'nejaky-model')).toBeNull();
    expect(estimateCostUsd('openai', 'nejaky-model', 1000, 1000)).toBeNull();
  });

  it('odhad ceny počítá z milionu tokenů', () => {
    // 200 000 vstupních a 40 000 výstupních tokenů na claude-opus-5
    expect(estimateCostUsd('anthropic', 'claude-opus-5', 200_000, 40_000)).toBeCloseTo(2, 6);
  });

  it('každý kurátorovaný model má kladné okno a strop výstupu', () => {
    for (const model of curatedModels('anthropic')) {
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});
