import { describe, expect, it, vi } from 'vitest';
import { createSystemContext } from '../../identity/context';
import { TrackingDomainCache, normalizeHost, originHost } from './domain-cache';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const OTHER = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';
const EMPTY = '0192f3a0-1c2d-7e40-9a1b-000000000000';

/**
 * Loader dostává KONTEXT, ne řetězec, protože přesně tak se cache ptá databáze.
 * Rozdělení po projektech tady modeluje to, co v provozu dělá `ws_isolation`:
 * v kontextu projektu jsou vidět jen jeho řádky.
 */
const byWorkspace: Record<string, Array<{ host: string; includeSubdomains: boolean }>> = {
  [WS]: [
    { host: 'shop.cz', includeSubdomains: false },
    { host: 'blog.example.cz', includeSubdomains: true },
  ],
  [OTHER]: [{ host: 'jiny.cz', includeSubdomains: false }],
};

function ctxOf(workspaceId: string) {
  return createSystemContext(workspaceId, 'test');
}

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
  function makeCache() {
    const load = vi.fn(async (ctx: { workspaceId: string }) => byWorkspace[ctx.workspaceId] ?? []);
    return { cache: new TrackingDomainCache({ ttlMs: 60_000, load }), load };
  }

  it('přesná shoda hostu projde', async () => {
    const { cache } = makeCache();
    await expect(cache.isAllowed(ctxOf(WS), 'shop.cz')).resolves.toBe(true);
  });

  it('subdoména projde jen při include_subdomains', async () => {
    const { cache } = makeCache();
    await expect(cache.isAllowed(ctxOf(WS), 'www.shop.cz')).resolves.toBe(false);
    await expect(cache.isAllowed(ctxOf(WS), 'cokoliv.blog.example.cz')).resolves.toBe(true);
    await expect(cache.isAllowed(ctxOf(WS), 'blog.example.cz')).resolves.toBe(true);
  });

  it('doména cizího projektu neprojde', async () => {
    const { cache } = makeCache();
    await expect(cache.isAllowed(ctxOf(WS), 'jiny.cz')).resolves.toBe(false);
    // a naopak: v kontextu druhého projektu platí jeho vlastní pravidlo
    await expect(cache.isAllowed(ctxOf(OTHER), 'jiny.cz')).resolves.toBe(true);
  });

  it('host, který jen končí stejnými znaky, neprojde', async () => {
    const { cache } = makeCache();
    await expect(cache.isAllowed(ctxOf(WS), 'zlyblog.example.cz')).resolves.toBe(false);
    await expect(cache.isAllowed(ctxOf(WS), 'nechceme-shop.cz')).resolves.toBe(false);
  });

  it('projekt bez jediné domény nemá povolený nic', async () => {
    const { cache } = makeCache();
    await expect(cache.isAllowed(ctxOf(EMPTY), 'shop.cz')).resolves.toBe(false);
  });

  it('načítá se jednou za projekt, ne při každém dotazu', async () => {
    const { cache, load } = makeCache();
    await cache.isAllowed(ctxOf(WS), 'shop.cz');
    await cache.isAllowed(ctxOf(WS), 'blog.example.cz');
    await cache.isAllowed(ctxOf(OTHER), 'jiny.cz');
    expect(load).toHaveBeenCalledTimes(2);
  });

  /**
   * Selhání dotazu nesmí shodit přesměrování. Bez seznamu se identita
   * NEPŘEDÁ, což je bezpečná strana chyby.
   */
  it('když načtení spadne, nepovolí nic a nevyhodí výjimku', async () => {
    const cache = new TrackingDomainCache({
      ttlMs: 60_000,
      load: async () => {
        throw new Error('databáze je pryč');
      },
    });
    await expect(cache.isAllowed(ctxOf(WS), 'shop.cz')).resolves.toBe(false);
  });
});
