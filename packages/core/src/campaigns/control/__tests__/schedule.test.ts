import { describe, expect, it } from 'vitest';
import {
  validateSchedule,
  truncateToMinute,
  isCatchupWindow,
  EDITABLE_WHILE_SCHEDULED,
} from '../schedule';

const now = new Date('2026-08-01T10:00:00.000Z');

describe('planovani', () => {
  it('mene nez 5 minut do budoucnosti je campaign_schedule_too_soon', () => {
    const r = validateSchedule({
      at: new Date('2026-08-01T10:03:00.000Z'),
      timezone: 'Europe/Prague',
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('campaign_schedule_too_soon');
  });

  it('vic nez 365 dni je campaign_schedule_too_far', () => {
    const r = validateSchedule({
      at: new Date('2027-10-01T10:00:00.000Z'),
      timezone: 'Europe/Prague',
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('campaign_schedule_too_far');
  });

  it('neplatna IANA zona je validation_failed', () => {
    const r = validateSchedule({
      at: new Date('2026-08-02T10:00:00.000Z'),
      timezone: 'Mars/Olympus',
      now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('validation_failed');
  });

  it('sekundy se orezavaji na nulu', () => {
    expect(truncateToMinute(new Date('2026-08-01T10:07:42.500Z')).toISOString()).toBe(
      '2026-08-01T10:07:00.000Z',
    );
  });

  it('9:00 Europe/Prague je v lete 07:00 UTC a v zime 08:00 UTC', () => {
    const summer = validateSchedule({
      at: new Date('2026-08-12T07:00:00.000Z'),
      timezone: 'Europe/Prague',
      now,
    });
    const winter = validateSchedule({
      at: new Date('2026-12-12T08:00:00.000Z'),
      timezone: 'Europe/Prague',
      now,
    });
    expect(summer.ok && summer.localHour).toBe(9);
    expect(winter.ok && winter.localHour).toBe(9);
  });

  it('catch-up okno: 3 hodiny ano, 9 hodin ne', () => {
    expect(
      isCatchupWindow({ scheduledAt: new Date('2026-08-01T07:00:00.000Z'), now, catchupHours: 6 }),
    ).toBe(true);
    expect(
      isCatchupWindow({ scheduledAt: new Date('2026-08-01T01:00:00.000Z'), now, catchupHours: 6 }),
    ).toBe(false);
  });

  it('ve stavu scheduled se smi menit jen jmeno, cas a zona', () => {
    expect([...EDITABLE_WHILE_SCHEDULED].sort()).toEqual([
      'name',
      'schedule_timezone',
      'scheduled_at',
    ]);
  });
});
