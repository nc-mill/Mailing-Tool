import { describe, expect, it } from 'vitest';
import { nextCheckAt, cacheTtlSeconds, runDomainChecks } from '../dns/check-domain';

describe('planovani kontrol domeny', () => {
  it.each([
    [5, 30],
    [60, 300],
    [10 * 60, 1800],
    [100 * 60, 6 * 3600],
  ])('po %s minutach od zalozeni je interval %s s', (ageMinutes, expected) => {
    expect(nextCheckAt({ ageMinutes, verified: false })).toBe(expected);
  });

  it('overena domena se kontroluje jednou za 24 hodin', () => {
    expect(nextCheckAt({ ageMinutes: 10_000, verified: true })).toBe(24 * 3600);
  });

  it('cache plati nejvyse 900 s a nejmene 60 s', () => {
    expect(cacheTtlSeconds([3600, 1800])).toBe(900);
    expect(cacheTtlSeconds([10])).toBe(60);
    expect(cacheTtlSeconds([300])).toBe(300);
  });

  it('cela kontrola ma strop 15 s, nedokoncene se zapisou jako null', async () => {
    const slow = () => new Promise((r) => setTimeout(() => r({ ok: true, findings: [] }), 50));
    const checks = await runDomainChecks({
      spf: slow as never,
      dkim: slow as never,
      dmarc: slow as never,
      mx: slow as never,
      overallTimeoutMs: 10,
    });
    expect(checks.spf.ok).toBeNull();
  });

  it('vysledek ma ctyri klice a kazdy nese checked_at', async () => {
    const ok = async () => ({ ok: true, findings: [] });
    const checks = await runDomainChecks({
      spf: ok as never,
      dkim: ok as never,
      dmarc: ok as never,
      mx: ok as never,
      overallTimeoutMs: 1000,
    });
    expect(Object.keys(checks).sort()).toEqual(['dkim', 'dmarc', 'mx', 'spf']);
    expect(checks.spf.checked_at).toMatch(/Z$/);
  });
});
