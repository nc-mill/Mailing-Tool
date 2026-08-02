import { describe, expect, it, vi } from 'vitest';
import { materializeHandler, MATERIALIZE_JOB } from '../materialize';

const RENDER_PLAN = {
  usedPaths: ['contact.first_name'],
  preparedSchema: { fields: ['contact.first_name'], presence: [] },
};

function harness(over: Record<string, unknown> = {}) {
  return {
    start: vi.fn(async () => ({
      audienceBuiltAt: '2026-08-01T00:00:00.000Z',
      releaseAt: '2026-08-01T00:01:00.000Z',
      claimed: true,
    })),
    readStatus: vi.fn(async () => 'queueing'),
    progress: vi.fn(async () => ({
      phase: 'materializing',
      cursor_contact_id: null,
      inserted_rows: 0,
    })),
    compileAudience: vi.fn(async () => ({ sql: 'true', params: [] })),
    countGates: vi.fn(async () => ({
      raw: 10,
      eligible: 10,
      excluded_suppressed: 0,
      excluded_unsubscribed: 0,
      excluded_unconfirmed: 0,
      excluded_snoozed: 0,
      excluded_processing_restricted: 0,
      excluded_invalid_email: 0,
      excluded_deleted: 0,
      excluded_sample: 0,
      duplicates_removed: 0,
    })),
    setGateCounters: vi.fn(async () => {}),
    renderPlan: vi.fn(async () => RENDER_PLAN),
    sampleContactIds: vi.fn(async () => []),
    trialSettings: vi.fn(async () => ({ trial_mode: false })),
    loop: vi.fn(async () => ({ outcome: 'completed' as const, inserted: 10, cursor: 'x' })),
    finish: vi.fn(async () => true),
    pause: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    ...over,
  };
}

describe('job campaign.materialize', () => {
  it('ma singletonKey vazany na kampan', () => {
    expect(MATERIALIZE_JOB.singletonKey('k1')).toBe('campaign.materialize:k1');
  });

  it('predava do davky plan pro render, jinak by render_data nemela _present', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.renderPlan).toHaveBeenCalledWith('k1');
    expect(h.loop).toHaveBeenCalledWith(expect.objectContaining({ renderPlan: RENDER_PLAN }));
  });

  it('nezkompilovana kampan se NEMATERIALIZUJE, skonci jako failed', async () => {
    const h = harness({
      renderPlan: vi.fn(async () => {
        throw new Error('campaign_not_compiled');
      }),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).not.toHaveBeenCalled();
    expect(h.fail).toHaveBeenCalledWith('k1', 'campaign_not_compiled');
  });

  it('undo okno se bere ze startu, ne z konfigurace, kterou nikdo neplni', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).toHaveBeenCalledWith(
      expect.objectContaining({ releaseAt: '2026-08-01T00:01:00.000Z' }),
    );
  });

  it('publikum se kompiluje s offsetem 5, jinak by se parametry prekryly', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.compileAudience).toHaveBeenCalledWith(expect.objectContaining({ paramOffset: 5 }));
  });

  it('rozpad bran se uklada CELY, ne slity do tri cisel', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    const passed = (h.setGateCounters.mock.calls[0] as unknown as unknown[])[1] as Record<
      string,
      number
    >;
    expect(Object.keys(passed)).toHaveLength(11);
    expect(passed).toHaveProperty('excluded_snoozed');
    expect(passed).toHaveProperty('excluded_sample');
  });

  it('uspesny beh dokonci krok 3 a posle webhook sending_started', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.finish).toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'campaign.sending_started' }),
    );
  });

  /**
   * Brana zkusebniho rezimu musi dojit az do smycky. Puvodni vada nebyla v tom,
   * ze by `canSendInTrial` pocitala spatne, ale v tom, ze ji nikdo nevolal;
   * kdyby job hodnotu precetl a zahodil, byla by chyba zpatky a tenhle soubor
   * by o tom mlcel.
   */
  it('precte zkusebni rezim JEDNOU a preda ho do smycky', async () => {
    const trial = {
      trial_mode: true,
      trial_verified: [{ email: 'overena@firma.cz', verified_at: '2026-08-01T10:00:00.000Z' }],
    };
    const h = harness({ trialSettings: vi.fn(async () => trial) });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.trialSettings).toHaveBeenCalledTimes(1);
    expect(h.loop).toHaveBeenCalledWith(expect.objectContaining({ trial }));
  });

  it('rozpad bran se ulozi jeste pred prvni davkou', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    const gatesOrder = h.setGateCounters.mock.invocationCallOrder[0]!;
    const loopOrder = h.loop.mock.invocationCallOrder[0]!;
    expect(gatesOrder).toBeLessThan(loopOrder);
  });

  it('timeout prevede kampan do paused s materialize_timeout a source app', async () => {
    const h = harness({
      loop: vi.fn(async () => ({ outcome: 'timeout', inserted: 5, cursor: 'x' })),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.pause).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({ code: 'materialize_timeout', source: 'app' }),
    );
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('neuspesny claim s paused konci bez chyby a bez davky', async () => {
    const h = harness({
      start: vi.fn(async () => ({
        audienceBuiltAt: '2026-08-01T00:00:00.000Z',
        claimed: false,
      })),
      readStatus: vi.fn(async () => 'paused'),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).not.toHaveBeenCalled();
  });

  it('neuspesny claim s queueing pokracuje od kurzoru', async () => {
    const h = harness({
      start: vi.fn(async () => ({
        audienceBuiltAt: '2026-08-01T00:00:00.000Z',
        claimed: false,
      })),
      readStatus: vi.fn(async () => 'queueing'),
      progress: vi.fn(async () => ({
        phase: 'materializing',
        cursor_contact_id: 'c-500',
        inserted_rows: 500,
      })),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).toHaveBeenCalledWith(expect.objectContaining({ startCursor: 'c-500' }));
  });
});
