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
    expect(report.byModel[1]!.estimatedCostUsd).toBeNull();
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
});
