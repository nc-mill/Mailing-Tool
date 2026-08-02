import type { resolveHostSafely as resolveHostSafelyImpl, MinimalResolver } from './resolve';
import { normalizeBrandUrl, type UrlPolicy } from './url';

export type SafeFetchPurpose = 'brand_html' | 'brand_asset' | 'robots' | 'link_check';

export type SafeFetchLimits = {
  purpose: SafeFetchPurpose;
  maxBytes: number;
  timeouts: { dns: number; connect: number; headers: number; body: number };
  acceptMimePrefixes: readonly string[];
};

export type SafeFetchPolicy = UrlPolicy & {
  allowPrivateNetworks: boolean;
  maxRedirects: number;
  dnsServers?: readonly string[] | undefined;
};

export type SafeFetchHop = { url: string; status: number; ipClass: 'public' };

export type SafeFetchResult =
  | {
      ok: true;
      finalUrl: string;
      status: number;
      headers: Record<string, string>;
      body: Buffer;
      hops: SafeFetchHop[];
      bytesRead: number;
    }
  | { ok: false; code: string; hops: SafeFetchHop[]; bytesRead: number };

export type SafeFetchRequest = (params: {
  url: string;
  pinnedIp: string;
  servername: string;
  limits: SafeFetchLimits;
  allowPrivateNetworks: boolean;
}) => Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  bodyChunks: Buffer[];
}>;

/**
 * Obě závislosti jsou POVINNÉ a obě se předávají shora.
 *
 * Dřívější podoba plánu měla `resolver` schovaný v `globalThis.__mlainResolver`,
 * což je globální stav, který nikdo nenastavoval: v produkci by byl `undefined`
 * a `resolveHostSafely` by spadlo na `options.resolver.resolve4` dřív, než by se
 * cokoliv zeptalo DNS. Testy to nechytily, protože všechny injektovaly
 * `resolveHostSafely` jako celek. Explicitní parametr tuhle třídu vady vylučuje:
 * bez resolveru se `safeFetch` nezkompiluje.
 *
 * Skutečné implementace obou sestavuje `createBrandRuntime()`.
 */
export type SafeFetchDeps = {
  resolveHostSafely: typeof resolveHostSafelyImpl;
  resolver: MinimalResolver;
  request: SafeFetchRequest;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

function isTimeout(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code.includes('TIMEOUT') || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
}

/**
 * Jediná cesta ven ze serveru pro uživatelem zadané adresy. Každý hop projde
 * kompletně celým řetězcem: normalizace, kontrola hostu, DNS, kontrola IP,
 * ověření po spojení. Přesměrování se obsluhuje ručně, protože `maxRedirections`
 * na úrovni undici by následovalo `Location` bez naší kontroly.
 */
export async function safeFetch(
  input: string,
  limits: SafeFetchLimits,
  policy: SafeFetchPolicy,
  deps: SafeFetchDeps,
): Promise<SafeFetchResult> {
  const resolve = deps.resolveHostSafely;
  const hops: SafeFetchHop[] = [];
  const seen = new Set<string>();
  let bytesRead = 0;
  let currentUrl = input;

  for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
    const normalized = normalizeBrandUrl(currentUrl, policy);
    if (!normalized.ok) return { ok: false, code: normalized.code, hops, bytesRead };

    if (seen.has(normalized.url)) {
      return { ok: false, code: 'brand_redirect_loop', hops, bytesRead };
    }
    seen.add(normalized.url);

    // Resolver přichází shora, ne z globálního stavu. Každý hop se rozlišuje
    // znovu: adresa ověřená u prvního hopu o druhém hopu nic neříká.
    const resolved = await resolve(normalized.hostname, {
      resolver: deps.resolver,
      timeoutMs: limits.timeouts.dns,
      dnsServers: policy.dnsServers,
      allowPrivateNetworks: policy.allowPrivateNetworks,
    });
    if (!resolved.ok) return { ok: false, code: resolved.code, hops, bytesRead };

    const pinnedIp = resolved.addresses[0];
    if (pinnedIp === undefined) {
      return { ok: false, code: 'brand_dns_failed', hops, bytesRead };
    }

    let response: Awaited<ReturnType<SafeFetchRequest>>;
    try {
      response = await deps.request({
        url: normalized.url,
        pinnedIp,
        servername: normalized.hostname,
        limits,
        allowPrivateNetworks: policy.allowPrivateNetworks,
      });
    } catch (error) {
      if (isTimeout(error)) return { ok: false, code: 'brand_timeout', hops, bytesRead };
      const code = (error as { code?: string } | null)?.code;
      if (code === 'brand_blocked_address') {
        return { ok: false, code: 'brand_blocked_address', hops, bytesRead };
      }
      return { ok: false, code: 'brand_fetch_failed', hops, bytesRead };
    }

    hops.push({ url: normalized.url, status: response.statusCode, ipClass: 'public' });

    if (REDIRECT_STATUSES.has(response.statusCode)) {
      const location = headerValue(response.headers, 'location');
      if (location === undefined) {
        return { ok: false, code: 'brand_fetch_failed', hops, bytesRead };
      }
      let next: URL;
      try {
        next = new URL(location, normalized.url);
      } catch {
        return { ok: false, code: 'brand_invalid_url', hops, bytesRead };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, code: 'brand_scheme_not_allowed', hops, bytesRead };
      }
      // Sestup z https na http je zakázaný. Opačný směr je v pořádku.
      if (normalized.protocol === 'https:' && next.protocol === 'http:') {
        return { ok: false, code: 'brand_insecure_redirect', hops, bytesRead };
      }
      currentUrl = next.toString();
      continue;
    }

    // Velikost se počítá ze streamu, ne z hlavičky Content-Length: hlavička je
    // tvrzení serveru, ne fakt.
    const body: Buffer[] = [];
    for (const chunk of response.bodyChunks) {
      bytesRead += chunk.byteLength;
      if (bytesRead > limits.maxBytes) {
        return { ok: false, code: 'brand_response_too_large', hops, bytesRead };
      }
      body.push(chunk);
    }

    const contentType = (headerValue(response.headers, 'content-type') ?? '').toLowerCase();
    const accepted = limits.acceptMimePrefixes.some((prefix) => contentType.startsWith(prefix));
    if (!accepted) {
      return { ok: false, code: 'brand_unexpected_content_type', hops, bytesRead };
    }

    const flatHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      flatHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    }

    return {
      ok: true,
      finalUrl: normalized.url,
      status: response.statusCode,
      headers: flatHeaders,
      body: Buffer.concat(body),
      hops,
      bytesRead,
    };
  }

  return { ok: false, code: 'brand_too_many_redirects', hops, bytesRead };
}
