import { describe, expect, it, vi } from 'vitest';
import { STALL_WATCH_QUIET_SECONDS } from '../../constants';
import { stallWatchHandler, type StallWatchDeps } from '../stall-watch';

const TED = new Date('2026-08-04T12:00:00.000Z');

function pred(sekund: number): Date {
  return new Date(TED.getTime() - sekund * 1000);
}

function harness(over: Partial<StallWatchDeps> = {}): {
  deps: StallWatchDeps;
  report: ReturnType<typeof vi.fn>;
} {
  const report = vi.fn();
  const deps: StallWatchDeps = {
    listRunning: async () => [{ workspaceId: 'w', campaignId: 'k', status: 'sending' }],
    outboxState: async () => ({ pending: 42, lastChangeAt: pred(600) }),
    report,
    now: () => TED,
    ...over,
  };
  return { deps, report };
}

describe('hlidac zaseknutych davek v outboxu', () => {
  it('nahlasi kampan, ktera odesila, ma co odeslat a dlouho se nehnula', async () => {
    const { deps, report } = harness();
    const stalled = await stallWatchHandler(deps);

    expect(stalled).toEqual([
      { workspaceId: 'w', campaignId: 'k', pending: 42, quietSeconds: 600 },
    ]);
    expect(report).toHaveBeenCalledWith(stalled);
  });

  /**
   * Tenhle případ je celý důvod, proč job vznikl: sender neběžel, kampaň měla
   * čtyřicet dva čekajících zpráv a nikde se to neprojevilo.
   */
  it('nahlasi i kampan, ktera se nehnula od zalozeni publika', async () => {
    const { deps } = harness({
      outboxState: async () => ({ pending: 1, lastChangeAt: pred(4 * 24 * 3600) }),
    });
    expect(await stallWatchHandler(deps)).toHaveLength(1);
  });

  it('mlci, dokud prah ticha neuplynul', async () => {
    const { deps } = harness({
      outboxState: async () => ({
        pending: 42,
        lastChangeAt: pred(STALL_WATCH_QUIET_SECONDS - 1),
      }),
    });
    expect(await stallWatchHandler(deps)).toEqual([]);
  });

  it('prazdny outbox neni zaseknuty, i kdyz se dlouho nic nedeje', async () => {
    const { deps } = harness({
      outboxState: async () => ({ pending: 0, lastChangeAt: pred(9999) }),
    });
    expect(await stallWatchHandler(deps)).toEqual([]);
  });

  /**
   * Pozastavená kampaň stojí schválně a hlásit ji jako zaseknutou by bylo
   * hlášení o vlastním nastavení. `queueing` se teprve materializuje.
   */
  it.each(['paused', 'queueing', 'draft'])('preskoci kampan ve stavu %s', async (status) => {
    const { deps } = harness({
      listRunning: async () => [{ workspaceId: 'w', campaignId: 'k', status }],
    });
    expect(await stallWatchHandler(deps)).toEqual([]);
  });

  it('kampan, ktera mezitim zmizela, nehlasi', async () => {
    const { deps } = harness({ outboxState: async () => null });
    expect(await stallWatchHandler(deps)).toEqual([]);
  });

  /**
   * Hlásí se JEDNÍM voláním i s prázdným seznamem. Bez toho by nešlo poznat
   * rozdíl mezi „hlídač proběhl a nic nenašel" a „hlídač vůbec neběžel".
   */
  it('ohlasi i prazdny vysledek, aby slo poznat, ze hlidac probehl', async () => {
    const { deps, report } = harness({ listRunning: async () => [] });
    await stallWatchHandler(deps);
    expect(report).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('projde vsechny kampane, ne jen prvni', async () => {
    const { deps } = harness({
      listRunning: async () => [
        { workspaceId: 'w', campaignId: 'a', status: 'sending' },
        { workspaceId: 'w', campaignId: 'b', status: 'paused' },
        { workspaceId: 'w2', campaignId: 'c', status: 'sending' },
      ],
    });
    const stalled = await stallWatchHandler(deps);
    expect(stalled.map((s) => s.campaignId)).toEqual(['a', 'c']);
  });
});
