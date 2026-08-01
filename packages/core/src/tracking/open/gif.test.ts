import { describe, expect, it } from 'vitest';
import { PIXEL_GIF, PIXEL_HEADERS } from './gif';

describe('open pixel response', () => {
  it('tělo má přesně 42 bajtů a odpovídá průhlednému GIFu 1x1', () => {
    expect(PIXEL_GIF).toHaveLength(42);
    expect(PIXEL_GIF.toString('hex')).toBe(
      '47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b',
    );
  });

  it('base64 podoba sedí na hodnotu z 3.2.2', () => {
    expect(PIXEL_GIF.toString('base64')).toBe(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    );
  });

  it('hlavičky zakazují kešování a únik referreru', () => {
    expect(PIXEL_HEADERS['Content-Type']).toBe('image/gif');
    expect(PIXEL_HEADERS['Content-Length']).toBe('42');
    expect(PIXEL_HEADERS['Cache-Control']).toContain('no-store');
    expect(PIXEL_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(PIXEL_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
