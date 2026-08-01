import { describe, expect, it } from 'vitest';
import { ProxyRangeIndex } from './proxy-ranges';
import { classifyOpen } from './classify-open';

const index = new ProxyRangeIndex([]);
const classify = (input: Omit<Parameters<typeof classifyOpen>[0], 'proxyRanges'>) =>
  classifyOpen({ proxyRanges: index, ...input });

describe('classifyOpen', () => {
  it('pravidlo 1: crawler je bot a vyhrává nad vším ostatním', () => {
    expect(
      classify({ userAgent: 'Googlebot/2.1', method: 'GET', headers: {}, ip: '17.1.1.1' }),
    ).toBe('bot');
  });

  it('pravidlo 2: prefetch hlavička je bot', () => {
    expect(
      classify({
        userAgent: 'Chrome/140.0',
        method: 'GET',
        headers: { purpose: 'prefetch' },
        ip: null,
      }),
    ).toBe('bot');
  });

  it('pravidlo 3: metoda HEAD je bot', () => {
    expect(classify({ userAgent: 'Chrome/140.0', method: 'HEAD', headers: {}, ip: null })).toBe(
      'bot',
    );
  });

  it('pravidlo 4: přesně Mozilla/5.0 je proxy_apple', () => {
    expect(classify({ userAgent: 'Mozilla/5.0', method: 'GET', headers: {}, ip: null })).toBe(
      'proxy_apple',
    );
    expect(classify({ userAgent: '  Mozilla/5.0 ', method: 'GET', headers: {}, ip: null })).toBe(
      'proxy_apple',
    );
  });

  it('pravidlo 4 nesmí chytit skutečný klient, který Mozilla/5.0 jen začíná', () => {
    expect(
      classify({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
        method: 'GET',
        headers: {},
        ip: null,
      }),
    ).toBe('human');
  });

  it('pravidlo 5: IP v 17.0.0.0/8 je proxy_apple i při neznámém UA', () => {
    expect(
      classify({ userAgent: 'cosi neznámého', method: 'GET', headers: {}, ip: '17.133.1.1' }),
    ).toBe('proxy_apple');
  });

  it('pravidlo 7: GoogleImageProxy je proxy_image', () => {
    expect(classify({ userAgent: 'GoogleImageProxy', method: 'GET', headers: {}, ip: null })).toBe(
      'proxy_image',
    );
  });

  it('pravidlo 8: poštovní bezpečnostní proxy je bot', () => {
    expect(
      classify({ userAgent: 'Barracuda Sentinel', method: 'GET', headers: {}, ip: null }),
    ).toBe('bot');
  });

  it('pravidlo 9: poštovní klient je human', () => {
    expect(
      classify({ userAgent: 'Microsoft Outlook 16.0', method: 'GET', headers: {}, ip: null }),
    ).toBe('human');
  });

  it('pravidlo 11: nic nesedí, tedy unknown', () => {
    expect(classify({ userAgent: 'curl/8.5.0', method: 'GET', headers: {}, ip: null })).toBe(
      'unknown',
    );
  });

  it('prázdný User-Agent je unknown, ne human', () => {
    expect(classify({ userAgent: '', method: 'GET', headers: {}, ip: null })).toBe('unknown');
  });
});
