import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrackingKeyring } from '../tokens/keyring';
import { LinkCache } from './link-cache';
import { TrackingDomainCache } from '../domains/domain-cache';
import { createClickHandler, type ClickHandlerDeps } from './handle-click';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const CLICK =
  't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw';
const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
const LINK = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';

function makeHandler(overrides: Partial<ClickHandlerDeps> = {}) {
  const buffered: unknown[] = [];
  const domains = new TrackingDomainCache({
    refreshMs: 60_000,
    load: async () => [{ id: 'd1', workspaceId: WS, host: 'shop.cz', includeSubdomains: false }],
  });
  const links = new LinkCache({
    capacity: 10,
    ttlMs: 900_000,
    load: async () => [
      {
        id: LINK,
        url: 'https://shop.cz/vyprodej',
        campaignId: CAMPAIGN,
        workspaceId: WS,
        position: 3,
      },
    ],
  });
  const handle = createClickHandler({
    keyring: ring,
    currentKeyId: 1,
    links,
    domains,
    push: (item) => buffered.push(item),
    lookupContactId: vi.fn(async () => CONTACT),
    isWebTrackingEnabled: () => true,
    identityTokenTtlSeconds: 900,
    contactLookupTimeoutMs: 30,
    ...overrides,
  });
  return { handle, buffered, domains };
}

describe('click handler', () => {
  let ctx: ReturnType<typeof makeHandler>;
  beforeEach(async () => {
    ctx = makeHandler();
    await ctx.domains.refresh();
  });

  it('vrátí Location přesně rovný uložené adrese plus ml_token', async () => {
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(out.status).toBe(302);
    expect(out.location).toMatch(/^https:\/\/shop\.cz\/vyprodej\?ml_token=t1/);
  });

  it('query z příchozího požadavku se do Location nikdy nepřenese', async () => {
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '?next=https://evil.example',
      now: new Date(),
    });
    expect(out.location).not.toContain('evil.example');
    expect(out.location).not.toContain('next=');
  });

  it('neplatný token vede na /t/expired a nezapíše nic', async () => {
    const out = await ctx.handle({
      token: 't1xxxx',
      userAgent: 'Chrome/140',
      method: 'GET',
      headers: {},
      ip: null,
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('/t/expired');
    expect(ctx.buffered).toHaveLength(0);
  });

  it('odkaz patřící jinému projektu než token vede na /t/expired', async () => {
    const other = makeHandler({
      links: new LinkCache({
        capacity: 10,
        ttlMs: 900_000,
        load: async () => [
          {
            id: LINK,
            url: 'https://shop.cz/x',
            campaignId: CAMPAIGN,
            workspaceId: '0192f3a0-1c2d-7e40-9a1b-000000000000',
            position: 1,
          },
        ],
      }),
    });
    await other.domains.refresh();
    const out = await other.handle({
      token: CLICK,
      userAgent: 'Chrome/140',
      method: 'GET',
      headers: {},
      ip: null,
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('/t/expired');
  });

  it('cíl mimo tracking_domains dostane Location bez ml_token a nesáhne na messages', async () => {
    const lookup = vi.fn(async () => CONTACT);
    const foreign = makeHandler({
      lookupContactId: lookup,
      links: new LinkCache({
        capacity: 10,
        ttlMs: 900_000,
        load: async () => [
          {
            id: LINK,
            url: 'https://facebook.com/nase-stranka',
            campaignId: CAMPAIGN,
            workspaceId: WS,
            position: 1,
          },
        ],
      }),
    });
    await foreign.domains.refresh();
    const out = await foreign.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: null,
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('https://facebook.com/nase-stranka');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skener dostane přesměrování, ale bez ml_token', async () => {
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Mimecast',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('https://shop.cz/vyprodej');
  });

  it('pomalé dohledání kontaktu přesměruje bez ml_token a v limitu', async () => {
    const slow = makeHandler({
      contactLookupTimeoutMs: 5,
      lookupContactId: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return CONTACT;
      },
    });
    await slow.domains.refresh();
    const started = Date.now();
    const out = await slow.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('https://shop.cz/vyprodej');
    expect(Date.now() - started).toBeLessThan(40);
  });

  it('do bufferu jde pozice odkazu, na který se kliklo', async () => {
    await ctx.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(ctx.buffered[0]).toMatchObject({ linkId: LINK, linkPosition: 3, campaignId: CAMPAIGN });
  });

  it('odpověď nese hlavičky, které brání úniku tokenu přes Referer', async () => {
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: null,
      query: '',
      now: new Date(),
    });
    expect(out.headers['Referrer-Policy']).toBe('no-referrer');
    expect(out.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(out.headers['Cache-Control']).toContain('no-store');
  });
});

/**
 * Ochrana proti otevřenému přesměrování se tady MĚŘÍ, ne popisuje. Každý test
 * se skutečně pokusí odvést uživatele na cizí doménu a ověří, že Location na ni
 * neukazuje. Kdyby se cíl kdykoliv začal skládat ze vstupu, spadne to tady.
 */
describe('ochrana proti open redirectu', () => {
  const ATTACKER = 'https://evil.example/prihlaseni';

  /** Všechny tvary, kterými se útočník snaží cíl podstrčit v požadavku. */
  const attackQueries = [
    `?next=${ATTACKER}`,
    `?url=${ATTACKER}`,
    `?redirect_uri=${encodeURIComponent(ATTACKER)}`,
    `?r=//evil.example`,
    `?u=%2F%2Fevil.example%2F`,
    `?ml_token=t1podvrzeny&next=${ATTACKER}`,
  ];

  it.each(attackQueries)('query %s cíl nezmění', async (query) => {
    const ctx = makeHandler();
    await ctx.domains.refresh();
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query,
      now: new Date(),
    });

    expect(out.status).toBe(302);
    expect(new URL(out.location).host).toBe('shop.cz');
    expect(out.location).not.toContain('evil.example');
  });

  it('hlavičky, kterými by šlo cíl přepsat, se ignorují', async () => {
    const ctx = makeHandler();
    await ctx.domains.refresh();
    const out = await ctx.handle({
      token: CLICK,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET',
      headers: {
        location: ATTACKER,
        referer: ATTACKER,
        'x-forwarded-host': 'evil.example',
        host: 'evil.example',
      },
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(new URL(out.location).host).toBe('shop.cz');
  });

  it('cizí doména v ULOŽENÉM odkazu identitu nedostane, i když na ni přesměrování vede', async () => {
    // Uložený cíl je jediný zdroj adresy, takže se na cizí doménu přesměrovat
    // MUSÍ. Co se na ni nesmí dostat, je ml_token: ten by z odkazu na cizí web
    // udělal únos identity kontaktu.
    const lookup = vi.fn(async () => CONTACT);
    const foreign = makeHandler({
      lookupContactId: lookup,
      links: new LinkCache({
        capacity: 10,
        ttlMs: 900_000,
        load: async () => [
          {
            id: LINK,
            url: 'https://evil.example/prihlaseni',
            campaignId: CAMPAIGN,
            workspaceId: WS,
            position: 1,
          },
        ],
      }),
    });
    await foreign.domains.refresh();
    const out = await foreign.handle({
      token: CLICK,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('https://evil.example/prihlaseni');
    expect(out.location).not.toContain('ml_token');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('host, který povolenou doménou jen KONČÍ, ml_token nedostane', async () => {
    const lookalike = makeHandler({
      links: new LinkCache({
        capacity: 10,
        ttlMs: 900_000,
        load: async () => [
          {
            id: LINK,
            url: 'https://evilshop.cz/prihlaseni',
            campaignId: CAMPAIGN,
            workspaceId: WS,
            position: 1,
          },
        ],
      }),
    });
    await lookalike.domains.refresh();
    const out = await lookalike.handle({
      token: CLICK,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: '203.0.113.7',
      query: '',
      now: new Date(),
    });
    expect(out.location).toBe('https://evilshop.cz/prihlaseni');
    expect(out.location).not.toContain('ml_token');
  });

  it('podvržený token na neexistující odkaz končí na /t/expired, ne na cizí doméně', async () => {
    const empty = makeHandler({
      links: new LinkCache({ capacity: 10, ttlMs: 900_000, load: async () => [] }),
    });
    await empty.domains.refresh();
    const out = await empty.handle({
      token: CLICK,
      userAgent: 'Chrome/140.0.0.0',
      method: 'GET',
      headers: {},
      ip: null,
      query: `?next=${ATTACKER}`,
      now: new Date(),
    });
    expect(out.location).toBe('/t/expired');
  });
});
