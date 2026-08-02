import { describe, expect, it } from 'vitest';
import { createBrandRuntime } from './runtime';

const config = {
  dnsServers: [] as string[],
  timeouts: { dns: 2000, connect: 3000, headers: 5000, body: 10_000 },
  maxHtmlBytes: 2 * 1024 * 1024,
  maxCssBytes: 512 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxCssFiles: 10,
  maxImageFiles: 10,
  allowHttp: true,
  allowPrivateNetworks: false,
  allowedHosts: [] as string[],
  blockedHosts: [] as string[],
  maxRedirects: 3,
  respectRobots: true,
  appUrl: 'https://mlain.test',
};

describe('createBrandRuntime', () => {
  it('sestaví resolver, který je skutečný Resolver, ne undefined', () => {
    const runtime = createBrandRuntime({ config });
    expect(runtime.deps.resolver).toBeDefined();
    expect(typeof runtime.deps.resolver.resolve4).toBe('function');
    expect(typeof runtime.deps.resolver.resolve6).toBe('function');
  });

  it('sestaví přenos, takže safeFetch má čím poslat požadavek', () => {
    const runtime = createBrandRuntime({ config });
    expect(typeof runtime.deps.request).toBe('function');
    expect(typeof runtime.deps.resolveHostSafely).toBe('function');
  });

  it('vydá fetchPage a checkRobots, které job očekává', () => {
    const runtime = createBrandRuntime({ config });
    expect(typeof runtime.fetchPage).toBe('function');
    expect(typeof runtime.checkRobots).toBe('function');
    expect(typeof runtime.fetchAssets).toBe('function');
  });

  it('vlastní DNS servery se nastaví jen tehdy, když jsou vyplněné', () => {
    const withServers = createBrandRuntime({ config: { ...config, dnsServers: ['1.1.1.1'] } });
    // `SafeFetchDeps.resolver` je záměrně minimální rozhraní bez `getServers`,
    // aby šlo v testech podstrčit atrapu. Skutečný `Resolver` metodu má a jen
    // tady se na ni sahá, protože se ověřuje právě to skutečné sestavení.
    const real = withServers.deps.resolver as unknown as { getServers: () => string[] };
    expect(real.getServers()).toContain('1.1.1.1');

    const withoutServers = createBrandRuntime({ config });
    const bare = withoutServers.deps.resolver as unknown as { getServers: () => string[] };
    expect(bare.getServers()).not.toContain('1.1.1.1');
  });

  it('politika se přebírá z konfigurace, ne natvrdo', () => {
    const runtime = createBrandRuntime({
      config: { ...config, allowHttp: false, maxRedirects: 1, blockedHosts: ['zly.example'] },
    });
    expect(runtime.policy.allowHttp).toBe(false);
    expect(runtime.policy.maxRedirects).toBe(1);
    expect(runtime.policy.blockedHosts).toContain('zly.example');
    expect(runtime.policy.allowPrivateNetworks).toBe(false);
  });

  it('vypnuté robots se neptají, ale odpověď má pořád tvar verdiktu', async () => {
    const runtime = createBrandRuntime({ config: { ...config, respectRobots: false } });
    // Bez sítě: `respectRobots: false` se nesmí dostat k žádnému stahování.
    await expect(runtime.checkRobots('https://kolo-shop.example/')).resolves.toMatchObject({
      allowed: true,
    });
  });
});
