import { describe, expect, it } from 'vitest';
import { EVENT_SOURCES, EVENT_NAME_RE, OPEN_CLASS_BIT } from './types';

describe('tracking types', () => {
  it('registr zdrojů události má pět hodnot a odpovídá ck_web_events__source', () => {
    expect([...EVENT_SOURCES]).toEqual(['web', 'server', 'email', 'automation', 'import']);
  });

  it('jméno události přijme povolený tvar a odmítne nepovolený', () => {
    expect(EVENT_NAME_RE.test('page_view')).toBe(true);
    expect(EVENT_NAME_RE.test('order_completed')).toBe(true);
    expect(EVENT_NAME_RE.test('Product Viewed')).toBe(false);
    expect(EVENT_NAME_RE.test('1page')).toBe(false);
    expect(EVENT_NAME_RE.test('a'.repeat(65))).toBe(false);
  });

  it('bitová maska tříd otevření odpovídá 2.6', () => {
    expect(OPEN_CLASS_BIT).toEqual({
      human: 1,
      proxy_apple: 2,
      proxy_image: 4,
      bot: 8,
      unknown: 16,
    });
  });
});
