import { describe, expect, it } from 'vitest';
import {
  pauseReasonSchema,
  PAUSE_REASON_CODES,
  SENDER_PAUSE_REASON_CODES,
  buildPauseReason,
  isAutoPause,
} from '../pause-reason';

describe('pause_reason', () => {
  it('registr ma devet kodu a ctyri z nich smi zapsat sender', () => {
    expect(PAUSE_REASON_CODES).toHaveLength(9);
    expect([...SENDER_PAUSE_REASON_CODES].sort()).toEqual([
      'credentials_undecryptable',
      'provider_quota_exhausted',
      'provider_unavailable',
      'render_failure_rate',
    ]);
  });

  it('hodnota quota z drivejsiho zneni v registru neni', () => {
    expect(PAUSE_REASON_CODES).not.toContain('quota');
  });

  it('povinne jsou code, source a at', () => {
    expect(pauseReasonSchema.safeParse({ code: 'user' }).success).toBe(false);
    expect(
      pauseReasonSchema.safeParse({
        code: 'user',
        source: 'user',
        at: '2026-07-31T14:22:31.000Z',
      }).success,
    ).toBe(true);
  });

  it('sender_id smi byt jen kdyz source je sender', () => {
    const bad = pauseReasonSchema.safeParse({
      code: 'user',
      source: 'user',
      at: '2026-07-31T14:22:31.000Z',
      sender_id: 'mlain-ws-7f3a',
    });
    expect(bad.success).toBe(false);
  });

  it('neznamy kod se toleruje, protoze vycet je otevreny', () => {
    const r = pauseReasonSchema.safeParse({
      code: 'something_new',
      source: 'sender',
      at: '2026-07-31T14:22:31.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('buildPauseReason vyrobi platny objekt s casem v UTC', () => {
    const r = buildPauseReason('bounce_guard', 'app', { detail: '8.4 %' });
    expect(pauseReasonSchema.parse(r).at.endsWith('Z')).toBe(true);
  });

  it('pauza uzivatele neni automaticka a nezapisuje campaign.auto_paused', () => {
    expect(isAutoPause({ code: 'user', source: 'user', at: '2026-07-31T14:22:31.000Z' })).toBe(
      false,
    );
    expect(
      isAutoPause({ code: 'bounce_guard', source: 'app', at: '2026-07-31T14:22:31.000Z' }),
    ).toBe(true);
  });
});
