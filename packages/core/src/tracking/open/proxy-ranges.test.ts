import { describe, expect, it } from 'vitest';
import { APPLE_FIXED_CIDR, ProxyRangeIndex } from './proxy-ranges';

describe('ProxyRangeIndex', () => {
  it('pevný Apple rozsah je 17.0.0.0/8 a platí i bez staženého seznamu', () => {
    expect(APPLE_FIXED_CIDR).toBe('17.0.0.0/8');
    const index = new ProxyRangeIndex([]);
    expect(index.match('17.133.1.1', 'email_open')).toBe('apple_private_relay');
    expect(index.match('18.133.1.1', 'email_open')).toBeNull();
  });

  it('ručně vložené rozsahy se vyhodnocují vždy', () => {
    const index = new ProxyRangeIndex([{ provider: 'manual', cidr: '203.0.113.0/24' }]);
    expect(index.match('203.0.113.7', 'email_open')).toBe('manual');
    expect(index.match('203.0.114.7', 'email_open')).toBe(null);
  });

  it('stažené Apple rozsahy se použijí jen při zapnutém přepínači', () => {
    const ranges = [{ provider: 'apple_private_relay' as const, cidr: '172.224.226.0/27' }];
    const off = new ProxyRangeIndex(ranges, { useAppleRelayRanges: false });
    const on = new ProxyRangeIndex(ranges, { useAppleRelayRanges: true });
    expect(off.match('172.224.226.5', 'email_open')).toBeNull();
    expect(on.match('172.224.226.5', 'email_open')).toBe('apple_private_relay');
  });

  it('IPv6 adresa nespadne a vrátí null, když není v žádném rozsahu', () => {
    const index = new ProxyRangeIndex([]);
    expect(index.match('2001:db8::1', 'email_open')).toBeNull();
  });

  it('nesmyslná adresa vrátí null, ne výjimku', () => {
    const index = new ProxyRangeIndex([]);
    expect(index.match('není-ip', 'email_open')).toBeNull();
  });

  it('parsování Apple CSV vezme první pole a přeskočí prázdné řádky', () => {
    const csv = '172.224.226.0/27,GB,GB-EN,London,\n172.224.226.32/31,GB,GB-SC,Aberdeen,\n\n';
    expect(ProxyRangeIndex.parseAppleCsv(csv)).toEqual(['172.224.226.0/27', '172.224.226.32/31']);
  });
});
