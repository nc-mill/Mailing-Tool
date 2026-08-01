import { describe, expect, it, vi } from 'vitest';
import { TrackingDomainCache, normalizeHost, originHost } from './domain-cache';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const OTHER = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';
const rows = [
  { id: 'd1', workspaceId: WS, host: 'shop.cz', includeSubdomains: false },
  { id: 'd2', workspaceId: WS, host: 'blog.example.cz', includeSubdomains: true },
  { id: 'd3', workspaceId: OTHER, host: 'jiny.cz', includeSubdomains: false },
];

describe('normalizeHost', () => {
  it('sundá schéma, port, tečku na konci a převede na malá písmena', () => {
    expect(normalizeHost('HTTPS://Shop.CZ:8443/cesta')).toBe('shop.cz');
    expect(normalizeHost('shop.cz.')).toBe('shop.cz');
  });
});

describe('originHost', () => {
  it('vytáhne host z hlavičky Origin', () => {
    expect(originHost('https://shop.cz')).toBe('shop.cz');
    expect(originHost('null')).toBeNull();
    expect(originHost(undefined)).toBeNull();
  });
});

describe('TrackingDomainCache', () => {
  const cache = new TrackingDomainCache({ refreshMs: 60_000, load: vi.fn(async () => rows) });

  it('přesná shoda hostu projde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'shop.cz')).toBe(true);
  });

  it('subdoména projde jen při include_subdomains', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'www.shop.cz')).toBe(false);
    expect(cache.isAllowed(WS, 'cokoliv.blog.example.cz')).toBe(true);
    expect(cache.isAllowed(WS, 'blog.example.cz')).toBe(true);
  });

  it('doména cizího projektu neprojde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'jiny.cz')).toBe(false);
  });

  it('host, který jen končí stejnými znaky, neprojde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'zlyblog.example.cz')).toBe(false);
    expect(cache.isAllowed(WS, 'nechceme-shop.cz')).toBe(false);
  });

  it('projekt bez jediné domény nemá povolený nic', async () => {
    await cache.refresh();
    expect(cache.isAllowed('0192f3a0-1c2d-7e40-9a1b-000000000000', 'shop.cz')).toBe(false);
  });
});
