import { describe, expect, it, vi } from 'vitest';
import { createPublicEventRoutes, type PublicEventDeps } from './public-events.routes';

function app(over: Partial<PublicEventDeps> = {}) {
  return createPublicEventRoutes({
    accept: vi.fn(async () => ({ status: 202 as const, body: { accepted: 1, rejected: 0 } })),
    identify: vi.fn(async () => ({ status: 202 as const, body: { ok: true } })),
    serveSdk: () =>
      new Response('/* sdk */', { headers: { 'content-type': 'application/javascript' } }),
    consumeRateLimit: async () => true,
    ...over,
  });
}

const body = JSON.stringify({
  v: 1,
  key: 'ml_pub_aebagbafaydqqcik',
  sent_at: '2026-07-31T12:00:00.000Z',
  events: [],
});

describe('/e routes', () => {
  it('POST /track přijme application/json i text/plain kvůli sendBeacon', async () => {
    for (const contentType of ['application/json', 'text/plain;charset=UTF-8']) {
      const res = await app().request('/track', {
        method: 'POST',
        body,
        headers: { 'content-type': contentType },
      });
      expect(res.status).toBe(202);
    }
  });

  it('/v1/batch je alias na /track a obsluhuje ho tentýž handler', async () => {
    const accept = vi.fn(async () => ({
      status: 202 as const,
      body: { accepted: 1, rejected: 0 },
    }));
    const res = await app({ accept }).request('/v1/batch', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('OPTIONS na libovolnou cestu pod /e vrátí 204 s CORS hlavičkami', async () => {
    for (const path of ['/track', '/identify', '/cokoliv']) {
      const res = await app().request(path, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    }
  });

  it('Access-Control-Allow-Credentials se nenastavuje, s hvězdičkou je to neplatné', async () => {
    const res = await app().request('/track', { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('POST /identify vrátí 202 a CORS hlavičku', async () => {
    const res = await app().request('/identify', {
      method: 'POST',
      body: JSON.stringify({
        v: 1,
        key: 'ml_pub_aebagbafaydqqcik',
        anonymous_id: 'a',
        token: 't1x',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('tělo nad 64 kB vrátí 413 a payload_too_large', async () => {
    const res = await app().request('/track', {
      method: 'POST',
      body: 'x'.repeat(65 * 1024),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('payload_too_large');
  });

  it('nevalidní JSON vrátí 400', async () => {
    const res = await app().request('/track', {
      method: 'POST',
      body: '{nevalidní',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('překročený limit vrátí 429 s Retry-After', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request('/track', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('GET /ml.js vrátí skript', async () => {
    const res = await app().request('/ml.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('Origin z požadavku se předává službě, jinak by kontrola domény neměla co porovnat', async () => {
    const seen: { origin: string | undefined }[] = [];
    const accept: PublicEventDeps['accept'] = async (_input, meta) => {
      seen.push({ origin: meta.origin });
      return { status: 202 as const, body: { accepted: 1, rejected: 0 } };
    };
    await app({ accept }).request('/track', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', origin: 'https://shop.cz' },
    });
    expect(seen[0]).toEqual({ origin: 'https://shop.cz' });
  });
});
