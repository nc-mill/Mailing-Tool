import { describe, expect, it, vi } from 'vitest';
import { buildUsageReport, recordUsage } from './usage';

describe('zápis spotřeby', () => {
  it('přičítá k dennímu agregátu, nezakládá řádek na zprávu', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>) => undefined);
    await recordUsage(
      {
        workspaceId: 'w1',
        provider: 'anthropic',
        model: 'claude-opus-5',
        inputTokens: 1200,
        outputTokens: 300,
        failed: false,
        day: '2026-07-31',
      },
      { upsertDailyUsage: upsert },
    );
    expect(upsert).toHaveBeenCalledWith({
      workspaceId: 'w1',
      day: '2026-07-31',
      provider: 'anthropic',
      model: 'claude-opus-5',
      requestsDelta: 1,
      inputTokensDelta: 1200,
      outputTokensDelta: 300,
      errorsDelta: 0,
      // Anthropic skutečnou cenu nehlásí, takže se nesmí zapsat ani nula:
      // nula by v přehledu znamenala „bylo to zadarmo".
      reportedCostDelta: null,
      reportedCostUnit: null,
      cacheReadTokensDelta: null,
      cacheWriteTokensDelta: null,
    });
  });

  it('neúspěšné volání zvýší chyby a nezapíše záporné tokeny', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>) => undefined);
    await recordUsage(
      {
        workspaceId: 'w1',
        provider: 'openai',
        model: 'x',
        inputTokens: -5,
        outputTokens: 0,
        failed: true,
        day: '2026-07-31',
      },
      { upsertDailyUsage: upsert },
    );
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      errorsDelta: 1,
      inputTokensDelta: 0,
      outputTokensDelta: 0,
    });
  });

  it('skutečnou cenu zapíše i s jednotkou, kterou určí poskytovatel', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>) => undefined);
    await recordUsage(
      {
        workspaceId: 'w1',
        provider: 'openrouter',
        model: 'nejaky/model',
        inputTokens: 1200,
        outputTokens: 300,
        failed: false,
        day: '2026-08-03',
        reported: { cost: 0.0042, cacheReadTokens: 64, cacheWriteTokens: 0 },
      },
      { upsertDailyUsage: upsert },
    );
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      reportedCostDelta: 0.0042,
      // Jednotku NEURČUJE volající, dosazuje ji katalog podle poskytovatele.
      reportedCostUnit: 'openrouter_credit',
      cacheReadTokensDelta: 64,
      // Nula od poskytovatele je měření, ne chybějící údaj, a ukládá se.
      cacheWriteTokensDelta: 0,
    });
  });

  it('u poskytovatele bez hlášené ceny se cena nevymyslí, ani když nějaké číslo přijde', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>) => undefined);
    await recordUsage(
      {
        workspaceId: 'w1',
        provider: 'anthropic',
        model: 'claude-opus-5',
        inputTokens: 10,
        outputTokens: 5,
        failed: false,
        day: '2026-08-03',
        // Kdyby sem někdo číslo protlačil, nesmí skončit v databázi bez známé
        // jednotky: bezejmenná částka je přesně to, z čeho vznikne záměna měn.
        reported: { cost: 1.23, cacheReadTokens: null, cacheWriteTokens: null },
      },
      { upsertDailyUsage: upsert },
    );
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      reportedCostDelta: null,
      reportedCostUnit: null,
      cacheReadTokensDelta: null,
      cacheWriteTokensDelta: null,
    });
  });

  it('záporná hlášená částka se zahodí, dobropis tudy nechodí', async () => {
    const upsert = vi.fn(async (_input: Record<string, unknown>) => undefined);
    await recordUsage(
      {
        workspaceId: 'w1',
        provider: 'openrouter',
        model: 'nejaky/model',
        inputTokens: 10,
        outputTokens: 5,
        failed: false,
        day: '2026-08-03',
        reported: { cost: -1, cacheReadTokens: null, cacheWriteTokens: null },
      },
      { upsertDailyUsage: upsert },
    );
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      reportedCostDelta: null,
      reportedCostUnit: null,
    });
  });
});

describe('sestava spotřeby', () => {
  const rows = [
    {
      day: '2026-07-30',
      provider: 'anthropic' as const,
      model: 'claude-opus-5',
      requests: 3,
      inputTokens: 30_000,
      outputTokens: 6_000,
      errors: 0,
    },
    {
      day: '2026-07-31',
      provider: 'anthropic' as const,
      model: 'claude-opus-5',
      requests: 2,
      inputTokens: 10_000,
      outputTokens: 2_000,
      errors: 1,
    },
    {
      day: '2026-07-31',
      provider: 'openai' as const,
      model: 'neznamy-model',
      requests: 1,
      inputTokens: 1_000,
      outputTokens: 100,
      errors: 0,
    },
  ];

  it('součty sedí s řádky, kritérium 72', () => {
    const report = buildUsageReport(rows);
    expect(report.totals).toEqual({
      requests: 6,
      inputTokens: 41_000,
      outputTokens: 8_100,
      errors: 1,
    });
  });

  it('rozpad podle modelu drží pořadí od nejdražšího po nejlevnější podle tokenů', () => {
    const report = buildUsageReport(rows);
    expect(report.byModel.map((m) => m.model)).toEqual(['claude-opus-5', 'neznamy-model']);
    expect(report.byModel[0]).toMatchObject({ inputTokens: 40_000, outputTokens: 8_000 });
  });

  it('odhad ceny se počítá jen u modelů z ceníku, ostatní mají null', () => {
    const report = buildUsageReport(rows);
    // 40 000 vstupních a 8 000 výstupních tokenů na claude-opus-5
    expect(report.byModel[0]!.estimatedCostUsd).toBeCloseTo(0.4, 6);
    expect(report.byModel[0]!.priceStatus).toBe('estimated');
    expect(report.byModel[1]!.estimatedCostUsd).toBeNull();
    expect(report.byModel[1]!.priceStatus).toBe('unknown');
  });

  it('rozpad ceny na vstup a výstup sedí se součtem', () => {
    const report = buildUsageReport(rows);
    const opus = report.byModel[0]!;
    // 40 000 × 5 / 1M = 0,2 vstup; 8 000 × 25 / 1M = 0,2 výstup
    expect(opus.inputCostUsd).toBeCloseTo(0.2, 6);
    expect(opus.outputCostUsd).toBeCloseTo(0.2, 6);
    expect(opus.inputCostUsd! + opus.outputCostUsd!).toBeCloseTo(opus.estimatedCostUsd!, 6);
  });

  it('u openrouteru se neříká „cenu neznáme", ale že ji vrací poskytovatel', () => {
    const report = buildUsageReport([
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'nejaky/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
      },
    ]);
    expect(report.byModel[0]!.priceStatus).toBe('provider_reports');
    expect(report.byModel[0]!.estimatedCostUsd).toBeNull();
    // Řádek z doby před migrací 0012: cenu nemáme uloženou, tak žádnou neuvádíme.
    expect(report.byModel[0]!.reportedCost).toBeNull();
    expect(report.byModel[0]!.reportedCostUnit).toBeNull();
  });

  it('uložená skutečná částka přebije stav „poskytovatel ji vrací" i odhad', () => {
    const report = buildUsageReport([
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'nejaky/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        reportedCost: 0.0042,
        reportedCostUnit: 'openrouter_credit',
        cacheReadTokens: 64,
        cacheWriteTokens: null,
      },
    ]);
    const entry = report.byModel[0]!;
    expect(entry.priceStatus).toBe('reported');
    expect(entry.reportedCost).toBeCloseTo(0.0042, 10);
    // Jednotka jde s částkou VŽDYCKY. Bez ní by z čísla někdo udělal dolary.
    expect(entry.reportedCostUnit).toBe('openrouter_credit');
    expect(entry.cacheReadTokens).toBe(64);
    expect(entry.cacheWriteTokens).toBeNull();
    expect(report.reportedCost).toBeCloseTo(0.0042, 10);
    expect(report.reportedCostUnit).toBe('openrouter_credit');
  });

  it('částky téhož modelu se přes dny sečtou, tokeny mezipaměti taky', () => {
    const report = buildUsageReport([
      {
        day: '2026-08-02',
        provider: 'openrouter' as const,
        model: 'nejaky/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        reportedCost: 0.001,
        reportedCostUnit: 'openrouter_credit',
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
      },
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'nejaky/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        reportedCost: 0.002,
        reportedCostUnit: 'openrouter_credit',
        cacheReadTokens: 20,
        cacheWriteTokens: null,
      },
    ]);
    expect(report.byModel[0]!.reportedCost).toBeCloseTo(0.003, 10);
    expect(report.byModel[0]!.cacheReadTokens).toBe(30);
    // Den bez zápisu do mezipaměti nesmí ten součet shodit na nulu.
    expect(report.byModel[0]!.cacheWriteTokens).toBe(5);
    expect(report.byDay[0]!.reportedCost).toBeCloseTo(0.001, 10);
    expect(report.byDay[1]!.reportedCost).toBeCloseTo(0.002, 10);
  });

  it('u poskytovatele bez hlášené ceny se nic nevymýšlí ani nedopočítává', () => {
    const report = buildUsageReport(rows);
    for (const entry of report.byModel) {
      expect(entry.reportedCost).toBeNull();
      expect(entry.reportedCostUnit).toBeNull();
      expect(entry.cacheReadTokens).toBeNull();
      expect(entry.cacheWriteTokens).toBeNull();
      expect(entry.priceStatus).not.toBe('reported');
    }
    expect(report.reportedCost).toBeNull();
    expect(report.reportedCostUnit).toBeNull();
    // Ani den beze spotřeby nesmí tvrdit, že mu poskytovatel naúčtoval nulu.
    const withRange = buildUsageReport(rows, { from: '2026-07-29', to: '2026-07-31' });
    expect(withRange.byDay[0]!.reportedCost).toBeNull();
    expect(withRange.byDay[0]!.estimatedCostUsd).toBe(0);
  });

  it('částka bez jednotky se do sestavy nedostane vůbec', () => {
    const report = buildUsageReport([
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'nejaky/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        // Databáze tuhle kombinaci nepustí (ck_ai_usage_daily__reported_cost),
        // sestava se přesto nesmí spolehnout na to, že data přijdou odtamtud.
        reportedCost: 1.5,
        reportedCostUnit: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ]);
    expect(report.byModel[0]!.reportedCost).toBeNull();
    expect(report.byModel[0]!.priceStatus).toBe('provider_reports');
    expect(report.reportedCost).toBeNull();
  });

  it('dvě různé jednotky se nesečtou, protože ten součet by neznamenal nic', () => {
    const report = buildUsageReport([
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'a/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        reportedCost: 1,
        reportedCostUnit: 'openrouter_credit',
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
      {
        day: '2026-08-03',
        provider: 'openrouter' as const,
        model: 'b/model',
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        errors: 0,
        reportedCost: 2,
        reportedCostUnit: 'vymyslena_jednotka',
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ]);
    // Jednotlivé modely si svoje částky ponechají, součet za období ne.
    expect(report.byModel.map((m) => m.reportedCost).sort()).toEqual([1, 2]);
    expect(report.reportedCost).toBeNull();
    expect(report.reportedCostUnit).toBeNull();
    expect(report.byDay[0]!.reportedCost).toBeNull();
  });

  it('celkový odhad je null, když aspoň jeden model v ceníku není', () => {
    expect(buildUsageReport(rows).estimatedCostUsd).toBeNull();
  });

  it('celkový odhad je číslo, když jsou všechny modely v ceníku', () => {
    const report = buildUsageReport(rows.slice(0, 2));
    expect(report.estimatedCostUsd).toBeCloseTo(0.4, 6);
  });

  it('denní řada je doplněná o dny bez spotřeby, aby graf neměl díry', () => {
    const report = buildUsageReport(rows, { from: '2026-07-29', to: '2026-07-31' });
    expect(report.byDay.map((d) => d.day)).toEqual(['2026-07-29', '2026-07-30', '2026-07-31']);
    expect(report.byDay[0]).toMatchObject({ requests: 0, inputTokens: 0, outputTokens: 0 });
  });

  it('den bez spotřeby stál nula, den s neznámým modelem má cenu null', () => {
    const report = buildUsageReport(rows, { from: '2026-07-29', to: '2026-07-31' });
    expect(report.byDay[0]!.estimatedCostUsd).toBe(0);
    // 30. 7. jen claude-opus-5, cenu známe
    expect(report.byDay[1]!.estimatedCostUsd).toBeCloseTo(0.3, 6);
    // 31. 7. je mezi modely i neznámý, takže se za ten den částka neuvádí
    expect(report.byDay[2]!.estimatedCostUsd).toBeNull();
  });
});

/*
 * PROTI SKUTEČNÝM DATŮM. Řádek je opsaný z databáze `mlain_clean` (3. 8. 2026),
 * protože zadavatel hlásil, že tabulka spotřeby „nefunguje". Test drží důkaz,
 * že sestava vydá přesně to, co je v databázi, a že jediné, co u tohohle
 * modelu chybět nesmí, je cena.
 */
describe('spotřeba z databáze projde sestavou beze změny', () => {
  const fromDatabase = [
    {
      day: '2026-08-03',
      provider: 'openai' as const,
      model: 'gpt-5.6-luna',
      requests: 13,
      inputTokens: 62_712,
      outputTokens: 5_575,
      errors: 0,
    },
  ];

  it('součty odpovídají řádku v ai_usage_daily', () => {
    const report = buildUsageReport(fromDatabase, { from: '2026-07-05', to: '2026-08-03' });
    expect(report.totals).toEqual({
      requests: 13,
      inputTokens: 62_712,
      outputTokens: 5_575,
      errors: 0,
    });
    expect(report.byDay).toHaveLength(30);
    expect(report.byDay.at(-1)).toMatchObject({ day: '2026-08-03', requests: 13 });
  });

  it('u gpt-5.6-luna se teď ukáže i částka, dřív tam nebyla', () => {
    const report = buildUsageReport(fromDatabase);
    const row = report.byModel[0]!;
    expect(row.priceStatus).toBe('estimated');
    // 62 712 × 0,20 / 1M = 0,0125424 ; 5 575 × 1,20 / 1M = 0,00669
    expect(row.inputCostUsd).toBeCloseTo(0.0125424, 9);
    expect(row.outputCostUsd).toBeCloseTo(0.00669, 9);
    expect(report.estimatedCostUsd).toBeCloseTo(0.0192324, 9);
  });

  it('u modelu s dražším tarifem pro dlouhé prompty je vidět upozornění', () => {
    expect(buildUsageReport(fromDatabase).hasLongContextCaveat).toBe(true);
    expect(buildUsageReport(fromDatabase).byModel[0]!.longContextThresholdTokens).toBe(272_000);
  });
});
