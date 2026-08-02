import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@mlain/core/tx', () => ({
  withReadOnly: vi.fn(
    async (_ctx: unknown, _options: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ marker: 'tx' }),
  ),
}));

vi.mock('@mlain/core/identity/context', () => ({
  createWorkspaceContext: vi.fn(async () => ({ workspaceId: 'w1' })),
}));

vi.mock('@mlain/core/ai', () => ({
  PRICING_UPDATED_AT: '2026-08-01',
  aiRepo: {
    listCredentials: vi.fn(async () => [
      {
        id: 'c1',
        provider: 'anthropic',
        label: 'Hlavní',
        keyHint: 'wxyz',
        keyFingerprint: 'abcdef0123456789',
        baseUrl: null,
        defaultModel: 'claude-opus-5',
        defaultCredential: true,
        lastUsedAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        createdAt: '2026-07-31T10:00:00.000Z',
        updatedAt: '2026-07-31T10:00:00.000Z',
      },
    ]),
    loadUsageRows: vi.fn(async () => []),
  },
  buildUsageReport: vi.fn(() => ({
    totals: { requests: 0, inputTokens: 0, outputTokens: 0, errors: 0 },
    byModel: [],
    byDay: [],
    estimatedCostUsd: null,
    pricingUpdatedAt: '2026-08-01',
  })),
  toPublicCredential: (row: Record<string, unknown>) => ({
    id: row['id'],
    provider: row['provider'],
    label: row['label'],
    key_hint: row['keyHint'],
    base_url: row['baseUrl'],
    default_model: row['defaultModel'],
    default_credential: row['defaultCredential'],
    last_used_at: row['lastUsedAt'],
    last_error_at: row['lastErrorAt'],
    last_error_code: row['lastErrorCode'],
    created_at: row['createdAt'],
    updated_at: row['updatedAt'],
  }),
}));

vi.mock('@mlain/core/brand', () => ({
  listBrandProfiles: vi.fn(async () => [{ id: 'b1', name: 'Kolo Shop' }]),
}));

const { fetchBrandProfiles, fetchCredentials, fetchUsage } = await import('./queries');

const ctx = { workspaceId: 'w1', actorId: 'u1' } as never;

describe('serverová čtení obrazovek', () => {
  it('fetchCredentials vrací veřejný tvar bez klíče a bez otisku', async () => {
    const rows = await fetchCredentials(ctx);
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('sk-');
    expect(serialized).not.toContain('enc:v1:');
    expect(serialized).not.toContain('abcdef0123456789');
    expect(rows[0]).toMatchObject({ key_hint: 'wxyz' });
  });

  it('fetchUsage a fetchBrandProfiles čtou v režimu jen pro čtení', async () => {
    const { withReadOnly } = await import('@mlain/core/tx');
    vi.mocked(withReadOnly).mockClear();
    await fetchUsage(ctx, 30);
    await fetchBrandProfiles(ctx);
    expect(withReadOnly).toHaveBeenCalledTimes(2);
  });

  it('fetchUsage se ptá na okno o zadaném počtu dnů, ne na celou historii', async () => {
    const { aiRepo } = await import('@mlain/core/ai');
    vi.mocked(aiRepo.loadUsageRows).mockClear();
    await fetchUsage(ctx, 30);
    const call = vi.mocked(aiRepo.loadUsageRows).mock.calls[0];
    const range = call?.[1] as { from: string; to: string };
    expect(range.from < range.to).toBe(true);
    const days =
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(29);
  });
});
