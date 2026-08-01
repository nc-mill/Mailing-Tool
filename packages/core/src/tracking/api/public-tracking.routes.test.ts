import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createPublicTrackingRoutes, type PublicTrackingDeps } from './public-tracking.routes';

const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';

function app(overrides: Partial<PublicTrackingDeps> = {}) {
  return createPublicTrackingRoutes({
    handleOpen: () => {},
    handleClick: async () => ({
      status: 302 as const,
      location: 'https://shop.cz/x',
      headers: { 'Referrer-Policy': 'no-referrer' },
    }),
    consumeRateLimit: async () => true,
    ...overrides,
  });
}

describe('/t routes', () => {
  it('platný pixel vrátí 200, image/gif a 42 bajtů', async () => {
    const res = await app().request(`/o/${OPEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect((await res.arrayBuffer()).byteLength).toBe(42);
  });

  it('neplatný token vrátí bajt po bajtu stejnou odpověď jako platný', async () => {
    const ok = await app().request(`/o/${OPEN}`);
    const bad = await app().request('/o/t1nesmysl');
    expect(bad.status).toBe(ok.status);
    expect(Buffer.from(await bad.arrayBuffer())).toEqual(Buffer.from(await ok.arrayBuffer()));
    expect(bad.headers.get('cache-control')).toBe(ok.headers.get('cache-control'));
  });

  it('překročený rate limit vrátí GIF, nikdy 429', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request(`/o/${OPEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
  });

  it('překročený rate limit u kliku přesměruje, nikdy nevrátí 429', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request('/c/t1cokoliv');
    expect(res.status).toBe(302);
  });

  it('klik vrátí 302 a hlavičku Referrer-Policy', async () => {
    const res = await app().request('/c/t1cokoliv');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://shop.cz/x');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('HEAD na klik vrátí přesměrování bez těla', async () => {
    const res = await app().request('/c/t1cokoliv', { method: 'HEAD' });
    expect(res.status).toBe(302);
    expect(await res.text()).toBe('');
  });

  it('token delší než 512 znaků vrátí 404 a handler se nezavolá', async () => {
    let called = false;
    const res = await app({
      handleOpen: () => {
        called = true;
      },
    }).request(`/o/${'a'.repeat(600)}`);
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it('podaplikace mountnutá pod /t odpovídá na /t/o/:token, ne až na /o/:token', async () => {
    // Regrese na skutečnou vadu: `podaplikace.basePath('/t')` prefix NEPŘIDÁ,
    // protože klon sdílí už naplněný router a prefix platí jen pro cesty
    // zaregistrované po jeho zavolání. Route handler v apps/web proto mountuje
    // přes `route()` a tenhle test hlídá, že se to nevrátí zpátky.
    const mounted = new Hono().route('/t', app());
    const res = await mounted.request(`/t/o/${OPEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');

    const wrong = await mounted.request(`/o/${OPEN}`);
    expect(wrong.status).toBe(404);
  });

  it('query z požadavku se předá handleru jako syrový řetězec, ne jako cíl', async () => {
    // Povrch query nezahazuje: předává ho dál, aby bylo v jednom místě vidět,
    // že se s ním nic nedělá. Cíl přesměrování vyrábí handleClick z databáze.
    let seenQuery: string | null = null;
    const res = await app({
      handleClick: async (request) => {
        seenQuery = request.query;
        return {
          status: 302 as const,
          location: 'https://shop.cz/x',
          headers: { 'Referrer-Policy': 'no-referrer' },
        };
      },
    }).request('/c/t1cokoliv?next=https://evil.example');
    expect(seenQuery).toBe('?next=https://evil.example');
    expect(res.headers.get('location')).toBe('https://shop.cz/x');
  });
});
