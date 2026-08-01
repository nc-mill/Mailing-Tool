import { PRICING_UPDATED_AT, estimateCostUsd } from './catalog';
import type { ProviderId } from './providers';

// Re-export ceníkového data drží UI a sestavu v jednom místě.
export { PRICING_UPDATED_AT };

export type UsageRow = {
  day: string;
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
};

export type UsageUpsert = {
  workspaceId: string;
  day: string;
  provider: ProviderId;
  model: string;
  requestsDelta: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
  errorsDelta: number;
};

export type UsageDeps = { upsertDailyUsage: (input: UsageUpsert) => Promise<void> };

const nonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

export async function recordUsage(
  params: {
    workspaceId: string;
    provider: ProviderId;
    model: string;
    inputTokens: number;
    outputTokens: number;
    failed: boolean;
    day: string;
  },
  deps: UsageDeps,
): Promise<void> {
  await deps.upsertDailyUsage({
    workspaceId: params.workspaceId,
    day: params.day,
    provider: params.provider,
    model: params.model,
    requestsDelta: 1,
    inputTokensDelta: nonNegative(params.inputTokens),
    outputTokensDelta: nonNegative(params.outputTokens),
    errorsDelta: params.failed ? 1 : 0,
  });
}

export type UsageByModel = {
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  /** `null` znamená "model není v ceníku". UI pak ukáže jen tokeny, ne peníze. */
  estimatedCostUsd: number | null;
};

export type UsageDay = {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
};

export type UsageReport = {
  totals: { requests: number; inputTokens: number; outputTokens: number; errors: number };
  byModel: UsageByModel[];
  byDay: UsageDay[];
  estimatedCostUsd: number | null;
  pricingUpdatedAt: string;
};

function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function buildUsageReport(
  rows: readonly UsageRow[],
  range?: { from: string; to: string },
): UsageReport {
  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      errors: acc.errors + row.errors,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, errors: 0 },
  );

  const modelMap = new Map<string, UsageByModel>();
  for (const row of rows) {
    const key = `${row.provider}/${row.model}`;
    const current = modelMap.get(key) ?? {
      provider: row.provider,
      model: row.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      estimatedCostUsd: null,
    };
    current.requests += row.requests;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.errors += row.errors;
    modelMap.set(key, current);
  }

  const byModel = [...modelMap.values()]
    .map((entry) => ({
      ...entry,
      estimatedCostUsd: estimateCostUsd(
        entry.provider,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
      ),
    }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));

  const dayMap = new Map<string, Omit<UsageDay, 'day'>>();
  for (const row of rows) {
    const current = dayMap.get(row.day) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
    };
    current.requests += row.requests;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.errors += row.errors;
    dayMap.set(row.day, current);
  }

  const days = range === undefined ? [...dayMap.keys()].sort() : eachDay(range.from, range.to);
  const byDay = days.map((day) => ({
    day,
    ...(dayMap.get(day) ?? { requests: 0, inputTokens: 0, outputTokens: 0, errors: 0 }),
  }));

  // Celkový odhad dává smysl jen tehdy, když je v ceníku každý použitý model.
  // Součet přes část modelů by uživateli lhal směrem dolů.
  const allPriced = byModel.every((entry) => entry.estimatedCostUsd !== null);
  const estimatedCostUsd = allPriced
    ? byModel.reduce((sum, entry) => sum + (entry.estimatedCostUsd ?? 0), 0)
    : null;

  return {
    totals,
    byModel,
    byDay,
    estimatedCostUsd,
    pricingUpdatedAt: PRICING_UPDATED_AT,
  };
}
