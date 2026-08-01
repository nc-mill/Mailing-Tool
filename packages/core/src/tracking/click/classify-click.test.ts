import { describe, expect, it } from 'vitest';
import { ScannerWindow, classifyClickHot, reclassifyClicks } from './classify-click';

describe('classifyClickHot', () => {
  it('pravidlo 1: crawler je bot', () => {
    expect(classifyClickHot({ userAgent: 'Googlebot/2.1', method: 'GET', headers: {} })).toBe(
      'bot',
    );
  });

  it('pravidlo 2: prefetch je prefetch, ne bot', () => {
    expect(
      classifyClickHot({
        userAgent: 'Chrome/140',
        method: 'GET',
        headers: { 'x-moz': 'prefetch' },
      }),
    ).toBe('prefetch');
  });

  it('pravidlo 3: HEAD je scanner', () => {
    expect(classifyClickHot({ userAgent: 'Chrome/140', method: 'HEAD', headers: {} })).toBe(
      'scanner',
    );
  });

  it('pravidlo 4: známý skener odkazů je scanner', () => {
    expect(
      classifyClickHot({ userAgent: 'Mimecast link protection', method: 'GET', headers: {} }),
    ).toBe('scanner');
  });

  it('pravidlo 7: chybějící User-Agent je bot', () => {
    expect(classifyClickHot({ userAgent: '', method: 'GET', headers: {} })).toBe('bot');
  });

  it('pravidlo 8: jinak human', () => {
    expect(
      classifyClickHot({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
        method: 'GET',
        headers: {},
      }),
    ).toBe('human');
  });
});

describe('reclassifyClicks', () => {
  const sentAt = new Date('2026-07-25T16:00:00Z');
  const base = {
    messageId: 'm1',
    ip: '203.0.113.7',
    clickClass: 'human' as const,
    linkId: 'l1',
    occurredAt: new Date('2026-07-25T16:00:10Z'),
  };

  it('pravidlo 5: klik do 5 sekund od sent_at je scanner', () => {
    const out = reclassifyClicks(
      [{ ...base, occurredAt: new Date('2026-07-25T16:00:03Z') }],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out[0]!.clickClass).toBe('scanner');
  });

  it('pravidlo 5: klik po 6 sekundách zůstává human', () => {
    const out = reclassifyClicks(
      [{ ...base, occurredAt: new Date('2026-07-25T16:00:06Z') }],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out[0]!.clickClass).toBe('human');
  });

  it('pravidlo 6: tři různé odkazy z jedné IP do 60 sekund jsou scanner včetně předchozích', () => {
    const window = new ScannerWindow();
    const out = reclassifyClicks(
      [
        { ...base, linkId: 'l1' },
        { ...base, linkId: 'l2', occurredAt: new Date('2026-07-25T16:00:20Z') },
        { ...base, linkId: 'l3', occurredAt: new Date('2026-07-25T16:00:30Z') },
      ],
      { m1: sentAt },
      window,
    );
    expect(out.map((c) => c.clickClass)).toEqual(['scanner', 'scanner', 'scanner']);
  });

  it('pravidlo 6 nesahá na dva odkazy, to je běžné chování člověka', () => {
    const out = reclassifyClicks(
      [
        { ...base, linkId: 'l1' },
        { ...base, linkId: 'l2', occurredAt: new Date('2026-07-25T16:00:20Z') },
      ],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out.map((c) => c.clickClass)).toEqual(['human', 'human']);
  });

  it('zpráva bez sent_at nespadne a klasifikaci nemění', () => {
    const out = reclassifyClicks([base], {}, new ScannerWindow());
    expect(out[0]!.clickClass).toBe('human');
  });
});
