import { describe, it, expect, beforeAll } from 'vitest';
import { applyUnitEnv } from '../test-support/unit-env';
import { BLOCKED_RANGES, isBlockedAddress, assertUrlAllowed, WEBHOOK_SSRF_POLICY } from './ssrf';

/**
 * ODCHYLKA OD PLÁNU: `WEBHOOK_SSRF_POLICY.allowPrivateNetworks` čte konfiguraci
 * líně (getter), takže testy, které politiku použijí, potřebují platné
 * prostředí. Bez toho by `loadConfig()` hodil ConfigError a test by padal
 * z důvodu, který se SSRF nemá nic společného.
 */
beforeAll(() => {
  applyUnitEnv();
});

describe('sdílený blocklist rozsahů', () => {
  it('obsahuje všech 15 rozsahů z 3.8', () => {
    expect(BLOCKED_RANGES).toEqual([
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '224.0.0.0/4',
      '240.0.0.0/4',
      '::1/128',
      'fc00::/7',
      'fe80::/10',
      '::ffff:0:0/96',
    ]);
  });

  it('blokuje metadata cloudu', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('metadata.google.internal')).toBe(false); // jméno, ne adresa
  });

  it('blokuje loopback, privátní a CGNAT rozsahy', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.5',
      '172.20.0.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blokuje IPv6 loopback, ULA, link-local a mapované IPv4', () => {
    for (const ip of ['::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('veřejné adresy propouští', () => {
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('politika odchozích webhooků', () => {
  it('je přísnější než stahování značky, protože přenáší podepsané tajemství', () => {
    expect(WEBHOOK_SSRF_POLICY.allowHttp).toBe(false);
    expect(WEBHOOK_SSRF_POLICY.maxRedirects).toBe(0);
  });

  it('https adresa na veřejný host projde', () => {
    expect(() => assertUrlAllowed('https://example.com/hook', WEBHOOK_SSRF_POLICY)).not.toThrow();
  });

  it('http adresa se odmítne', () => {
    expect(() => assertUrlAllowed('http://example.com/hook', WEBHOOK_SSRF_POLICY)).toThrow(
      /schema/i,
    );
  });

  it('literální privátní adresa se odmítne už při ukládání', () => {
    expect(() => assertUrlAllowed('http://169.254.169.254/', WEBHOOK_SSRF_POLICY)).toThrow();
    expect(() => assertUrlAllowed('https://169.254.169.254/', WEBHOOK_SSRF_POLICY)).toThrow(
      /blocked/i,
    );
    expect(() => assertUrlAllowed('https://127.0.0.1/hook', WEBHOOK_SSRF_POLICY)).toThrow(
      /blocked/i,
    );
  });

  it('nesmyslná adresa se odmítne', () => {
    expect(() => assertUrlAllowed('tohle-neni-url', WEBHOOK_SSRF_POLICY)).toThrow();
  });

  it('jiné schéma než http a https se odmítne', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd', WEBHOOK_SSRF_POLICY)).toThrow();
    expect(() => assertUrlAllowed('gopher://example.com/', WEBHOOK_SSRF_POLICY)).toThrow();
  });

  it('při allowPrivateNetworks projde i privátní adresa', () => {
    expect(() =>
      assertUrlAllowed('https://10.0.0.1/hook', {
        ...WEBHOOK_SSRF_POLICY,
        allowPrivateNetworks: true,
      }),
    ).not.toThrow();
  });

  it('extraBlockedHosts zabírá na jméno hosta', () => {
    expect(() =>
      assertUrlAllowed('https://metadata.google.internal/x', {
        ...WEBHOOK_SSRF_POLICY,
        extraBlockedHosts: ['metadata.google.internal'],
      }),
    ).toThrow();
  });

  it('allowedHosts funguje jako allowlist, když není prázdný', () => {
    const policy = { ...WEBHOOK_SSRF_POLICY, allowedHosts: ['example.com'] };
    expect(() => assertUrlAllowed('https://example.com/x', policy)).not.toThrow();
    expect(() => assertUrlAllowed('https://jiny.example.org/x', policy)).toThrow();
  });
});
