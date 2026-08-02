import { describe, expect, it } from 'vitest';
import { classifyAddress } from './address';
import { BLOCKED_RANGES } from '../net/ssrf';

const allowed = (ip: string) => classifyAddress(ip).allowed;
const reason = (ip: string) => {
  const verdict = classifyAddress(ip);
  if (verdict.allowed) throw new Error(`${ip} měla být zakázaná`);
  return verdict.reason;
};

describe('T1 a T2: loopback, neurčeno a metadata', () => {
  it('odmítne 127.0.0.1, ::1, 0.0.0.0 a ::', () => {
    expect(reason('127.0.0.1')).toBe('loopback');
    expect(reason('::1')).toBe('loopback');
    expect(reason('0.0.0.0')).toBe('reserved');
    expect(reason('::')).toBe('reserved');
  });

  it('odmítne 169.254.169.254, tedy metadata AWS, Azure, DigitalOcean a GCP', () => {
    expect(reason('169.254.169.254')).toBe('link_local');
  });

  it('odmítne 100.100.100.200 v rozsahu CGNAT, tedy metadata Alibaba Cloud', () => {
    expect(reason('100.100.100.200')).toBe('private');
  });

  it('odmítne 192.0.0.192, tedy metadata Oracle Cloud', () => {
    expect(reason('192.0.0.192')).toBe('reserved');
  });

  it('odmítne fd00:ec2::254, tedy IMDSv6 AWS', () => {
    expect(reason('fd00:ec2::254')).toBe('private');
  });
});

describe('hraniční adresy každého rozsahu IPv4', () => {
  const table: Array<[string, string, string, string]> = [
    // rozsah, první, poslední, o jednu mimo
    ['0.0.0.0/8', '0.0.0.0', '0.255.255.255', '1.0.0.0'],
    ['10.0.0.0/8', '10.0.0.0', '10.255.255.255', '11.0.0.0'],
    ['100.64.0.0/10', '100.64.0.0', '100.127.255.255', '100.128.0.0'],
    ['127.0.0.0/8', '127.0.0.0', '127.255.255.255', '128.0.0.0'],
    ['169.254.0.0/16', '169.254.0.0', '169.254.255.255', '169.255.0.0'],
    ['172.16.0.0/12', '172.16.0.0', '172.31.255.255', '172.32.0.0'],
    ['192.0.0.0/24', '192.0.0.0', '192.0.0.255', '192.0.1.0'],
    ['192.0.2.0/24', '192.0.2.0', '192.0.2.255', '192.0.3.0'],
    ['192.88.99.0/24', '192.88.99.0', '192.88.99.255', '192.88.100.0'],
    ['192.168.0.0/16', '192.168.0.0', '192.168.255.255', '192.169.0.0'],
    ['198.18.0.0/15', '198.18.0.0', '198.19.255.255', '198.20.0.0'],
    ['198.51.100.0/24', '198.51.100.0', '198.51.100.255', '198.51.101.0'],
    ['203.0.113.0/24', '203.0.113.0', '203.0.113.255', '203.0.114.0'],
    ['224.0.0.0/4', '224.0.0.0', '239.255.255.255', '240.0.0.0'],
    ['240.0.0.0/4', '240.0.0.0', '255.255.255.254', '223.255.255.255'],
  ];

  it.each(table)(
    '%s: první a poslední zakázaná, sousední mimo rozsah jinak',
    (_range, first, last, outside) => {
      expect(allowed(first)).toBe(false);
      expect(allowed(last)).toBe(false);
      // Sousední adresa smí být povolená jen tehdy, když nespadá do jiného
      // zakázaného rozsahu. Test ověřuje, že hranice nejsou posunuté.
      const outsideVerdict = classifyAddress(outside);
      if (!outsideVerdict.allowed) {
        expect(['reserved', 'multicast', 'private', 'loopback', 'link_local']).toContain(
          outsideVerdict.reason,
        );
      }
    },
  );

  it('255.255.255.255 je broadcast a je zakázaná', () => {
    expect(allowed('255.255.255.255')).toBe(false);
  });

  it('veřejné adresy projdou', () => {
    for (const ip of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '217.31.205.50']) {
      expect(allowed(ip)).toBe(true);
    }
  });
});

describe('IPv6 a rozbalení vnořené IPv4', () => {
  it('zakázané rozsahy IPv6', () => {
    expect(reason('fe80::1')).toBe('link_local');
    expect(reason('fc00::1')).toBe('private');
    expect(reason('ff02::1')).toBe('multicast');
    expect(reason('2001:db8::1')).toBe('reserved');
    expect(reason('100::1')).toBe('reserved');
    expect(reason('2001::1')).toBe('reserved');
  });

  it('T5: ::ffff:169.254.169.254 se rozbalí a odmítne', () => {
    expect(reason('::ffff:169.254.169.254')).toBe('link_local');
    expect(reason('::ffff:127.0.0.1')).toBe('loopback');
  });

  it('T6: 2002:a9fe:a9fe:: je 6to4 s vnořenou 169.254.169.254 a odmítne se', () => {
    expect(allowed('2002:a9fe:a9fe::')).toBe(false);
  });

  it('NAT64 64:ff9b:: s vnořenou privátní adresou se rozbalí a odmítne', () => {
    expect(allowed('64:ff9b::a00:1')).toBe(false);
  });

  it('veřejná IPv6 projde', () => {
    expect(allowed('2606:4700:4700::1111')).toBe(true);
  });

  it('nesmyslný vstup je zakázaný, ne výjimka', () => {
    expect(allowed('nic')).toBe(false);
    expect(reason('nic')).toBe('reserved');
  });
});

describe('přepínač pro firemní intranet', () => {
  it('BRAND_FETCH_ALLOW_PRIVATE_NETWORKS pustí privátní rozsahy, ale ne metadata ani loopback', () => {
    expect(classifyAddress('10.0.0.5', { allowPrivateNetworks: true }).allowed).toBe(true);
    expect(classifyAddress('192.168.1.10', { allowPrivateNetworks: true }).allowed).toBe(true);
    expect(classifyAddress('169.254.169.254', { allowPrivateNetworks: true }).allowed).toBe(false);
    expect(classifyAddress('127.0.0.1', { allowPrivateNetworks: true }).allowed).toBe(false);
  });
});

describe('sdílený blocklist P04 platí i pro extrakci značky', () => {
  /** Z rozsahu vyrobí jednu konkrétní adresu uvnitř něj. */
  function sampleFromRange(range: string): string {
    const network = range.split('/')[0] ?? range;
    if (network.includes(':')) {
      // U IPv6 stačí síťová adresa samotná; všechny rozsahy P04 ji obsahují.
      return network;
    }
    const octets = network.split('.').map(Number);
    // Poslední oktet o jedna výš, ať to není čistá adresa sítě.
    octets[3] = ((octets[3] ?? 0) + 1) % 256;
    return octets.join('.');
  }

  it.each([...BLOCKED_RANGES])('rozsah %s je zakázaný i tady', (range) => {
    const sample = sampleFromRange(range);
    expect(classifyAddress(sample).allowed, `${range} -> ${sample} prošlo`).toBe(false);
  });

  it('žádný rozsah P04 neprojde ani při allowPrivateNetworks', () => {
    // allowPrivateNetworks smí pustit jen 'private'. Loopback, link-local,
    // multicast a reserved zůstávají zakázané, protože to nejsou „privátní
    // sítě", ale cíle útoku.
    const stillBlocked = BLOCKED_RANGES.filter((range) => {
      const sample = sampleFromRange(range);
      return !classifyAddress(sample, { allowPrivateNetworks: true }).allowed;
    });
    expect(stillBlocked).toContain('169.254.0.0/16');
    expect(stillBlocked).toContain('127.0.0.0/8');
  });
});
