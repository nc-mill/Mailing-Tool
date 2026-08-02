import { describe, expect, it, vi } from 'vitest';
import type { RenderPlan } from '../../repo/outbox';
import { runMaterializeLoop, type LoopDeps } from '../loop';
import type { ResolvedTrialSettings } from '../../../providers/trial-mode';

/**
 * Vypnuty zkusebni rezim. Brana `canSendInTrial` je od teto zmeny POVINNY vstup
 * materializace, takze si ji kazdy test musi vyslovne rozhodnout.
 */
const TRIAL_OFF: ResolvedTrialSettings = { trial_mode: false };

/**
 * Plán tuhle konstantu ve svém snippetu používal, ale nedefinoval. Šablona bez merge
 * tagů a bez podmínek, tedy nejlevnější platný plán renderu.
 */
const EMPTY_RENDER_PLAN: RenderPlan = {
  usedPaths: [],
  preparedSchema: { fields: [], presence: [] },
};

function deps(over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    batch: vi.fn(async () => ({ scanned: 10, inserted: 10, nextCursor: 'c-next' })),
    advanceCursor: vi.fn(async () => {}),
    readStatus: vi.fn(async () => 'queueing' as const),
    now: () => new Date(0),
    cleanupCancelled: vi.fn(async () => 0),
    log: vi.fn(),
    ...over,
  };
}

const base = {
  campaignId: 'k1',
  audienceBuiltAt: '2026-08-01T00:00:00.000Z',
  startCursor: '00000000-0000-0000-0000-000000000000',
  batchSize: 500,
  maxMinutes: 60,
  where: { sql: 'true', params: [] },
  renderPlan: EMPTY_RENDER_PLAN,
  sampleContactIds: [],
  releaseAt: null,
  trial: TRIAL_OFF,
};

describe('smycka materializace', () => {
  it('konci, kdyz davka vrati prazdny kurzor', async () => {
    const d = deps({ batch: vi.fn(async () => ({ scanned: 0, inserted: 0, nextCursor: null })) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('completed');
  });

  it('po kazde davce se ptá na stav kampane', async () => {
    const d = deps({
      batch: vi
        .fn()
        .mockResolvedValueOnce({ scanned: 10, inserted: 10, nextCursor: 'a' })
        .mockResolvedValueOnce({ scanned: 0, inserted: 0, nextCursor: null }),
    });
    await runMaterializeLoop(d, base);
    expect(d.readStatus).toHaveBeenCalledTimes(2);
  });

  it('pri paused se zastavi a kurzor zustane', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'paused' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('paused');
    expect(d.advanceCursor).toHaveBeenCalled();
  });

  it('pri cancelled se zastavi A ZNOVU SPUSTI uklid', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'cancelled' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('cancelled');
    expect(d.cleanupCancelled).toHaveBeenCalledTimes(1);
  });

  it('po prekroceni stropu vraci timeout, ne nekonecnou smycku', async () => {
    let t = 0;
    const d = deps({
      now: () => new Date((t += 61 * 60 * 1000)),
    });
    const r = await runMaterializeLoop(d, { ...base, maxMinutes: 60 });
    expect(r.outcome).toBe('timeout');
  });

  it('neznamy stav zastavi a zaloguje warn', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'draft' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('aborted');
    expect(d.log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything());
  });
});
