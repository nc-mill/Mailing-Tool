import { describe, expect, it, vi } from 'vitest';
import { safeFetch, type SafeFetchDeps, type SafeFetchRequest } from './safe-fetch';
import { resolveHostSafely } from './resolve';

const limits = {
  timeouts: { dns: 2000, connect: 3000, headers: 5000, body: 10_000 },
  maxBytes: 2 * 1024 * 1024,
  acceptMimePrefixes: ['text/html', 'application/xhtml+xml'],
  purpose: 'brand_html' as const,
};

const policy = {
  allowHttp: true,
  allowPrivateNetworks: false,
  blockedHosts: ['metadata.google.internal'],
  allowedHosts: [] as string[],
  maxRedirects: 3,
};

/** Resolver je povinný parametr, takže ho musí dodat i test. */
const stubResolver = (byHost: Record<string, string[]> = {}) => ({
  resolve4: vi.fn(async (hostname: string) => byHost[hostname] ?? ['93.184.216.34']),
  resolve6: vi.fn(async () => [] as string[]),
  setServers: vi.fn(),
});

const deps = (over: Partial<SafeFetchDeps> = {}): SafeFetchDeps => ({
  resolveHostSafely: vi.fn(async () => ({ ok: true as const, addresses: ['93.184.216.34'] })),
  resolver: stubResolver(),
  request: vi.fn(async () => ({
    statusCode: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    bodyChunks: [Buffer.from('<html><body>ok</body></html>')],
  })),
  ...over,
});

describe('safeFetch, šťastná cesta', () => {
  it('stáhne stránku a vrátí tělo, stav a hopy bez IP adres', async () => {
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.body.toString()).toContain('ok');
    expect(result.hops).toEqual([{ url: 'https://kolo-shop.cz/', status: 200, ipClass: 'public' }]);
    expect(JSON.stringify(result.hops)).not.toContain('93.184.216.34');
  });
});

describe('safeFetch, limity', () => {
  it('T11: tělo delší než limit ukončí spojení, i když Content-Length lže', async () => {
    const d = deps({
      request: vi.fn(async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html', 'content-length': '100' },
        bodyChunks: [Buffer.alloc(3 * 1024 * 1024, 0x61)],
      })),
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, d);
    expect(result).toMatchObject({ ok: false, code: 'brand_response_too_large' });
  });

  it('T12: limit se uplatní na rozbalená data, ne na komprimovaná', async () => {
    const d = deps({
      request: vi.fn(async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
        // undici rozbaluje, takže sem přijdou už rozbalené bajty
        bodyChunks: Array.from({ length: 600 }, () => Buffer.alloc(1024 * 1024, 0x61)),
      })),
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, d);
    expect(result).toMatchObject({ ok: false, code: 'brand_response_too_large' });
  });

  it('T13: pomalá odpověď skončí jako brand_timeout', async () => {
    const d = deps({
      request: vi.fn(async () => {
        throw Object.assign(new Error('timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
      }),
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, d);
    expect(result).toMatchObject({ ok: false, code: 'brand_timeout' });
  });

  it('T14: nesouhlasný Content-Type je brand_unexpected_content_type', async () => {
    const d = deps({
      request: vi.fn(async () => ({
        statusCode: 200,
        headers: { 'content-type': 'application/octet-stream' },
        bodyChunks: [Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
      })),
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, d);
    expect(result).toMatchObject({ ok: false, code: 'brand_unexpected_content_type' });
  });
});

describe('safeFetch, přesměrování', () => {
  /*
   * ODCHYLKA OD PLÁNU, vynucená měřením. Plán začínal na `https://` a nechával
   * cíl přesměrovat na `http://169.254.169.254/`. Takový hop ale padne dřív na
   * zákazu sestupu z https na http, takže by test měřil jinou ochranu, než
   * o které mluví jeho jméno. Začátek je proto `http://`, ať se doopravdy
   * uplatní kontrola adresy druhého hopu.
   */
  it('T9: druhý hop na 169.254.169.254 se odmítne', async () => {
    const request = vi.fn<SafeFetchRequest>().mockResolvedValueOnce({
      statusCode: 301,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      bodyChunks: [],
    });
    const resolveHostSafelyMock = vi
      .fn<SafeFetchDeps['resolveHostSafely']>()
      .mockResolvedValueOnce({ ok: true, addresses: ['93.184.216.34'] })
      .mockResolvedValueOnce({ ok: false, code: 'brand_blocked_address' });
    const result = await safeFetch('http://ok-shop.cz/', limits, policy, {
      ...deps(),
      request,
      resolveHostSafely: resolveHostSafelyMock,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
  });

  it('T10: čtvrté přesměrování je brand_too_many_redirects', async () => {
    let counter = 0;
    const requestCycling = vi.fn<SafeFetchRequest>(async () => {
      counter += 1;
      return {
        statusCode: 302,
        headers: { location: `https://kolo-shop.cz/krok-${counter}` },
        bodyChunks: [],
      };
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, {
      ...deps(),
      request: requestCycling,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_too_many_redirects' });
  });

  it('přesměrování z https na http je zakázané', async () => {
    const requestOnce = vi.fn<SafeFetchRequest>(async () => ({
      statusCode: 301,
      headers: { location: 'http://kolo-shop.cz/' },
      bodyChunks: [],
    }));
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, {
      ...deps(),
      request: requestOnce,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_insecure_redirect' });
  });

  it('opačný směr, tedy http na https, je v pořádku', async () => {
    const request = vi
      .fn<SafeFetchRequest>()
      .mockResolvedValueOnce({
        statusCode: 301,
        headers: { location: 'https://kolo-shop.cz/' },
        bodyChunks: [],
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        bodyChunks: [Buffer.from('<html></html>')],
      });
    const result = await safeFetch('http://kolo-shop.cz/', limits, policy, {
      ...deps(),
      request,
    });
    expect(result.ok).toBe(true);
  });

  it('cyklus je brand_redirect_loop', async () => {
    const request = vi.fn<SafeFetchRequest>(async () => ({
      statusCode: 302,
      headers: { location: 'https://kolo-shop.cz/' },
      bodyChunks: [],
    }));
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, {
      ...deps(),
      request,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_redirect_loop' });
  });

  it('Location s jiným schématem než http a https je chyba', async () => {
    const request = vi.fn<SafeFetchRequest>(async () => ({
      statusCode: 302,
      headers: { location: 'file:///etc/passwd' },
      bodyChunks: [],
    }));
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, {
      ...deps(),
      request,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_scheme_not_allowed' });
  });

  it('relativní Location se rozpustí proti aktuální adrese', async () => {
    const request = vi
      .fn<SafeFetchRequest>()
      .mockResolvedValueOnce({ statusCode: 302, headers: { location: '/cs/' }, bodyChunks: [] })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        bodyChunks: [Buffer.from('<html></html>')],
      });
    const result = await safeFetch('https://kolo-shop.cz/uvod', limits, policy, {
      ...deps(),
      request,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalUrl).toBe('https://kolo-shop.cz/cs/');
  });

  it('meta refresh se nenásleduje, stránka se zpracuje tak, jak přišla', async () => {
    const d = deps({
      request: vi.fn(async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        bodyChunks: [
          Buffer.from(
            '<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1/"></head></html>',
          ),
        ],
      })),
    });
    const result = await safeFetch('https://kolo-shop.cz/', limits, policy, d);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finalUrl).toBe('https://kolo-shop.cz/');
    expect(d.request).toHaveBeenCalledTimes(1);
  });
});

/**
 * Tenhle blok schválně NEinjektuje `resolveHostSafely`, ale používá skutečnou
 * implementaci se zmokovaným resolverem. Jen tak se doopravdy měří klasifikace
 * adres; s mockem celého rozlišení by test ověřoval sám sebe.
 */
describe('safeFetch, ochrana proti SSRF na skutečné klasifikaci adres', () => {
  const realDeps = (over: Partial<SafeFetchDeps> = {}): SafeFetchDeps => ({
    ...deps(over),
    resolveHostSafely,
    ...over,
  });

  it('jméno, které se přeloží na 127.0.0.1, se nestáhne', async () => {
    const request = vi.fn<SafeFetchRequest>();
    const result = await safeFetch('https://rebind-shop.cz/', limits, policy, {
      ...realDeps({ request }),
      resolver: stubResolver({ 'rebind-shop.cz': ['127.0.0.1'] }),
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    expect(request).not.toHaveBeenCalled();
  });

  it('jméno, které se přeloží do 10.0.0.0/8, se nestáhne', async () => {
    const request = vi.fn<SafeFetchRequest>();
    const result = await safeFetch('https://intranet-shop.cz/', limits, policy, {
      ...realDeps({ request }),
      resolver: stubResolver({ 'intranet-shop.cz': ['10.11.12.13'] }),
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    expect(request).not.toHaveBeenCalled();
  });

  it('metadata endpoint cloudu 169.254.169.254 se nestáhne ani jako IP literál', async () => {
    const request = vi.fn<SafeFetchRequest>();
    const result = await safeFetch(
      'http://169.254.169.254/latest/meta-data/',
      limits,
      policy,
      realDeps({ request }),
    );
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    expect(request).not.toHaveBeenCalled();
  });

  it('přesměrování, které teprve vede do privátního rozsahu, se odmítne na druhém hopu', async () => {
    const request = vi.fn<SafeFetchRequest>().mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: 'http://vnitrni-web.cz/' },
      bodyChunks: [],
    });
    const result = await safeFetch('http://verejny-web.cz/', limits, policy, {
      ...realDeps({ request }),
      resolver: stubResolver({
        'verejny-web.cz': ['93.184.216.34'],
        'vnitrni-web.cz': ['192.168.7.7'],
      }),
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    // První hop proběhl, druhý už ne: zablokovala ho kontrola adresy, ne server.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('přesměrování na metadata endpoint se odmítne, i když první hop byl veřejný', async () => {
    const request = vi.fn<SafeFetchRequest>().mockResolvedValueOnce({
      statusCode: 301,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      bodyChunks: [],
    });
    const result = await safeFetch('http://verejny-web.cz/', limits, policy, {
      ...realDeps({ request }),
      resolver: stubResolver({ 'verejny-web.cz': ['93.184.216.34'] }),
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_blocked_address' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('host s příponou .local neprojde ani do DNS', async () => {
    const resolver = stubResolver();
    const result = await safeFetch('http://tiskarna.local/', limits, policy, {
      ...realDeps(),
      resolver,
    });
    expect(result).toMatchObject({ ok: false, code: 'brand_host_not_allowed' });
    expect(resolver.resolve4).not.toHaveBeenCalled();
  });
});
