import { describe, expect, it } from 'vitest';
import { correctOccurredAt } from './clock-skew';

const serverNow = new Date('2026-07-31T12:00:00.000Z');

describe('correctOccurredAt', () => {
  it('posun hodin klienta se dopočítá a použije', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-31T11:59:00.000Z'),
      sentAt: new Date('2026-07-31T11:59:30.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-31T11:59:30.000Z');
    expect(out.clockSkewMs).toBe(30_000);
  });

  it('posun nad 24 hodin se zahodí a použije se čas serveru', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('1970-01-01T00:00:00.000Z'),
      sentAt: new Date('1970-01-01T00:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt).toEqual(serverNow);
  });

  it('čas se ořízne na sedm dní zpět s minutovou rezervou, aby prošel constraintem', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-01T12:00:00.000Z'),
      sentAt: new Date('2026-07-31T12:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-24T12:01:00.000Z');
  });

  it('čas se ořízne na 60 sekund dopředu', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-31T12:10:00.000Z'),
      sentAt: new Date('2026-07-31T12:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-31T12:01:00.000Z');
  });
});
