import { describe, expect, it } from 'vitest';
import {
  APPLE_MPP_EXACT_UA,
  IMAGE_PROXY_RE,
  MAIL_CLIENT_RE,
  BROWSER_RE,
  SCANNER_RE,
  SECURITY_PROXY_RE,
  isCrawlerUserAgent,
  isPrefetchRequest,
} from './ua-rules';

describe('ua rules', () => {
  it('rozpozná známého crawlera', () => {
    expect(
      isCrawlerUserAgent(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toBe(true);
    expect(
      isCrawlerUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'),
    ).toBe(false);
  });

  it('Apple proxy posílá doslova Mozilla/5.0 bez dalších tokenů', () => {
    expect(APPLE_MPP_EXACT_UA).toBe('Mozilla/5.0');
    expect('  Mozilla/5.0  '.trim()).toBe(APPLE_MPP_EXACT_UA);
  });

  it('rozpozná obrazové proxy Googlu', () => {
    expect(IMAGE_PROXY_RE.test('GoogleImageProxy')).toBe(true);
    expect(IMAGE_PROXY_RE.test('Mozilla/5.0 via ggpht.com GoogleImageProxy')).toBe(true);
  });

  it('rozpozná bezpečnostní proxy poštovních bran', () => {
    for (const ua of ['YahooMailProxy', 'Barracuda Sentinel', 'ProofPoint-Scanner']) {
      expect(SECURITY_PROXY_RE.test(ua)).toBe(true);
    }
  });

  it('rozpozná bezpečnostní skenery odkazů', () => {
    for (const ua of [
      'Safelinks',
      'ProofPoint',
      'Mimecast',
      'Barracuda',
      'urldefense',
      'Symantec',
      'FireEye',
    ]) {
      expect(SCANNER_RE.test(ua)).toBe(true);
    }
  });

  it('rozpozná poštovní klienty a prohlížeče', () => {
    expect(MAIL_CLIENT_RE.test('Microsoft Outlook 16.0')).toBe(true);
    expect(MAIL_CLIENT_RE.test('Mozilla/5.0 (Macintosh) Thunderbird/128.0')).toBe(true);
    expect(BROWSER_RE.test('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36')).toBe(
      true,
    );
  });

  it('rozpozná prefetch podle všech čtyř hlaviček', () => {
    expect(isPrefetchRequest({ purpose: 'prefetch' })).toBe(true);
    expect(isPrefetchRequest({ 'x-purpose': 'preview' })).toBe(true);
    expect(isPrefetchRequest({ 'x-moz': 'prefetch' })).toBe(true);
    expect(isPrefetchRequest({ 'sec-purpose': 'prefetch;prerender' })).toBe(true);
    expect(isPrefetchRequest({ 'user-agent': 'Chrome' })).toBe(false);
  });
});
