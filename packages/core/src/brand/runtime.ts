import { Resolver } from 'node:dns/promises';
import { resolveHostSafely } from './resolve';
import { createUndiciRequest } from './transport';
import {
  safeFetch,
  type SafeFetchDeps,
  type SafeFetchLimits,
  type SafeFetchPolicy,
  type SafeFetchResult,
} from './safe-fetch';
import { checkRobotsAllowed, type RobotsVerdict } from './robots';

export type BrandRuntimeConfig = {
  dnsServers: readonly string[];
  timeouts: { dns: number; connect: number; headers: number; body: number };
  maxHtmlBytes: number;
  maxCssBytes: number;
  maxImageBytes: number;
  maxCssFiles: number;
  maxImageFiles: number;
  allowHttp: boolean;
  allowPrivateNetworks: boolean;
  allowedHosts: readonly string[];
  blockedHosts: readonly string[];
  maxRedirects: number;
  respectRobots: boolean;
  /** Veřejná adresa instalace. Jde do hlavičky User-Agent, aby šlo dohledat, kdo stahuje. */
  appUrl: string;
};

export type BrandRuntime = {
  deps: SafeFetchDeps;
  policy: SafeFetchPolicy;
  fetchPage: (url: string) => Promise<SafeFetchResult>;
  checkRobots: (url: string) => Promise<RobotsVerdict>;
  fetchAssets: (urls: readonly string[]) => Promise<Array<{ url: string; body: Buffer }>>;
};

const ROBOTS_MAX_BYTES = 100 * 1024;

/**
 * Jediné místo, kde vzniká skutečný resolver a skutečný přenos.
 *
 * Dřív se resolver četl z `globalThis.__mlainResolver`, což nikdo nenastavoval,
 * takže by každá reálná extrakce spadla na `undefined.resolve4`. Testy to
 * nechytily, protože injektovaly `resolveHostSafely` jako celek.
 */
export function createBrandRuntime(input: { config: BrandRuntimeConfig }): BrandRuntime {
  const { config } = input;

  const resolver = new Resolver({ timeout: config.timeouts.dns, tries: 1 });
  if (config.dnsServers.length > 0) {
    resolver.setServers([...config.dnsServers]);
  }

  const deps: SafeFetchDeps = {
    resolveHostSafely,
    resolver,
    request: createUndiciRequest(),
  };

  const policy: SafeFetchPolicy = {
    allowHttp: config.allowHttp,
    allowPrivateNetworks: config.allowPrivateNetworks,
    allowedHosts: [...config.allowedHosts],
    blockedHosts: [...config.blockedHosts],
    maxRedirects: config.maxRedirects,
    dnsServers: config.dnsServers,
  };

  const limitsFor = (purpose: SafeFetchLimits['purpose']): SafeFetchLimits => {
    const maxBytes =
      purpose === 'brand_html'
        ? config.maxHtmlBytes
        : purpose === 'robots'
          ? ROBOTS_MAX_BYTES
          : purpose === 'brand_asset'
            ? Math.max(config.maxCssBytes, config.maxImageBytes)
            : config.maxHtmlBytes;
    const acceptMimePrefixes =
      purpose === 'brand_html'
        ? ['text/html', 'application/xhtml+xml']
        : purpose === 'robots'
          ? ['text/plain']
          : ['text/css', 'image/', 'font/', 'application/font'];
    return { purpose, maxBytes, timeouts: config.timeouts, acceptMimePrefixes };
  };

  return {
    deps,
    policy,
    fetchPage: (url: string) => safeFetch(url, limitsFor('brand_html'), policy, deps),
    checkRobots: (url: string) =>
      checkRobotsAllowed(url, {
        limits: limitsFor('robots'),
        policy,
        deps,
        appUrl: config.appUrl,
        respectRobots: config.respectRobots,
      }),
    fetchAssets: async (urls: readonly string[]) => {
      const collected: Array<{ url: string; body: Buffer }> = [];
      // Limity na počet souborů platí tady, ne až u volajícího: stáhnout
      // dvě stě stylopisů a teprve pak jich devadesát procent zahodit
      // je samo o sobě způsob, jak nás zaměstnat.
      for (const url of urls.slice(0, config.maxCssFiles + config.maxImageFiles)) {
        const result = await safeFetch(url, limitsFor('brand_asset'), policy, deps);
        if (result.ok) collected.push({ url, body: result.body });
      }
      return collected;
    },
  };
}
