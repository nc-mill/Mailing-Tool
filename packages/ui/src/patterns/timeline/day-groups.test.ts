import { describe, expect, it } from 'vitest';
import { groupByDay } from './day-groups';
import type { TimelineItem } from './types';

function item(id: string, iso: string): TimelineItem {
  const occurredAt = new Date(iso);
  return {
    kind: 'single',
    id,
    type: 'page_view',
    occurredAt,
    event: { id, type: 'page_view', occurredAt, payload: {} },
  };
}

const now = new Date('2026-07-31T12:00:00.000Z');

describe('groupByDay', () => {
  it('rozdělí položky na dny v zóně uživatele', () => {
    const groups = groupByDay(
      [item('a', '2026-07-31T10:00:00.000Z'), item('b', '2026-07-30T10:00:00.000Z')],
      { timeZone: 'Europe/Prague', now },
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe('today');
    expect(groups[1]?.label).toBe('yesterday');
  });

  it('zóna uživatele rozhoduje, ne UTC', () => {
    // 23:30 UTC je v Praze už 1:30 dalšího dne.
    const groups = groupByDay([item('a', '2026-07-30T23:30:00.000Z')], {
      timeZone: 'Europe/Prague',
      now,
    });
    expect(groups[0]?.key).toBe('2026-07-31');
    expect(groups[0]?.label).toBe('today');
  });

  it('v jiné zóně vyjde jiný den', () => {
    const groups = groupByDay([item('a', '2026-07-30T23:30:00.000Z')], {
      timeZone: 'UTC',
      now,
    });
    expect(groups[0]?.key).toBe('2026-07-30');
    expect(groups[0]?.label).toBe('yesterday');
  });

  it('starší dny dostanou obyčejné datum', () => {
    const groups = groupByDay([item('a', '2026-06-12T10:00:00.000Z')], {
      timeZone: 'Europe/Prague',
      now,
    });
    expect(groups[0]?.label).toBe('date');
  });

  it('položky uvnitř dne si drží pořadí od nejnovější', () => {
    const groups = groupByDay(
      [item('a', '2026-07-31T14:42:00.000Z'), item('b', '2026-07-31T14:38:00.000Z')],
      { timeZone: 'Europe/Prague', now },
    );
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
