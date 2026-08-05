import { describe, expect, it } from 'vitest';
import {
  CATALOG_UPDATED_AT,
  PRICING_SOURCES,
  PRICING_UPDATED_AT,
  curatedModels,
  defaultModelFor,
  estimateCostBreakdown,
  estimateCostUsd,
  longContextThresholdFor,
  priceFor,
  providerReportsCost,
} from './catalog';
import { PROVIDER_IDS } from './providers';

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
    expect(priceFor('anthropic', 'claude-opus-5')).toMatchObject({
      inputPerMTokUsd: 5,
      outputPerMTokUsd: 25,
    });
    expect(priceFor('anthropic', 'claude-haiku-4-5-20251001')).toMatchObject({
      inputPerMTokUsd: 1,
      outputPerMTokUsd: 5,
    });
  });

  /*
   * KAŽDÝ MODEL, KTERÝ APLIKACE NABÍZÍ, MUSÍ MÍT CENU. Přesně tohle se v praxi
   * rozešlo: v ceníku byly čtyři modely Anthropicu a nic víc, takže kdokoliv
   * s jiným providerem viděl spotřebu bez peněz a myslel si, že měření
   * nefunguje. Test hlídá směr katalog → ceník; opačný směr schválně ne,
   * v ceníku smí být i modely, které nekurátorujeme (u providerů se seznamovým
   * endpointem si model vybírá uživatel).
   */
  it('každý kurátorovaný model má cenu v ceníku', () => {
    const missing: string[] = [];
    for (const provider of PROVIDER_IDS) {
      for (const model of curatedModels(provider)) {
        if (priceFor(provider, model.id) === null) missing.push(`${provider}/${model.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('model, který uživatel opravdu používá, je v ceníku', () => {
    expect(priceFor('openai', 'gpt-5.6-luna')).toMatchObject({
      inputPerMTokUsd: 0.2,
      outputPerMTokUsd: 1.2,
    });
  });

  it('u každého providera v ceníku je doložený zdroj i datum ověření', () => {
    for (const key of Object.keys(PRICING_SOURCES)) {
      const source = PRICING_SOURCES[key];
      expect(source?.url).toMatch(/^https:\/\//);
      expect(source?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(Object.keys(PRICING_SOURCES).sort()).toEqual(['anthropic', 'openai']);
  });

  it('sazba za čtení z mezipaměti nikdy není nula místo neznáma', () => {
    // Nula by znamenala „mezipaměť je zdarma"; kde cenu nemáme, pole chybí.
    expect(priceFor('openai', 'gpt-5-pro')?.cachedInputPerMTokUsd).toBeUndefined();
    expect(priceFor('openai', 'gpt-5.6-luna')?.cachedInputPerMTokUsd).toBe(0.02);
  });

  it('model mimo ceník vrátí null, ne nulu ani odhad', () => {
    expect(priceFor('openai', 'nejaky-model')).toBeNull();
    expect(estimateCostUsd('openai', 'nejaky-model', 1000, 1000)).toBeNull();
  });

  it('odhad ceny počítá z milionu tokenů', () => {
    // 200 000 vstupních a 40 000 výstupních tokenů na claude-opus-5
    expect(estimateCostUsd('anthropic', 'claude-opus-5', 200_000, 40_000)).toBeCloseTo(2, 6);
  });

  it('rozpad odděluje vstup od výstupu', () => {
    // 1 000 000 vstupních a 1 000 000 výstupních tokenů na gpt-5.6-luna
    const breakdown = estimateCostBreakdown('openai', 'gpt-5.6-luna', 1_000_000, 1_000_000);
    expect(breakdown?.inputUsd).toBeCloseTo(0.2, 6);
    expect(breakdown?.outputUsd).toBeCloseTo(1.2, 6);
    expect(breakdown?.totalUsd).toBeCloseTo(1.4, 6);
    expect(estimateCostBreakdown('openai', 'neznamy-model', 10, 10)).toBeNull();
  });

  it('u modelů s dražším tarifem pro dlouhé prompty je znát práh', () => {
    expect(longContextThresholdFor('openai', 'gpt-5.6-luna')).toBe(272_000);
    expect(longContextThresholdFor('anthropic', 'claude-opus-5')).toBeNull();
  });

  it('openrouter vrací skutečnou cenu sám, ostatní ne', () => {
    expect(providerReportsCost('openrouter')).toBe(true);
    expect(providerReportsCost('openai')).toBe(false);
    expect(providerReportsCost('anthropic')).toBe(false);
  });

  it('každý kurátorovaný model má kladné okno a strop výstupu', () => {
    for (const model of curatedModels('anthropic')) {
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});
