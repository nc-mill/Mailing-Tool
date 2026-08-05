import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSdk } from '../src/index';

describe('Mlain SDK', () => {
  let requests: { url: string; body: unknown }[];
  let sdk: ReturnType<typeof createSdk>;

  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{"accepted":1,"rejected":0}', { status: 202 });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    localStorage.clear();
    sessionStorage.clear();
    // ODCHYLKA OD PLÁNU: happy-dom maže cookie jen podle Expires, Max-Age ignoruje.
    document.cookie = 'ml_aid=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej');
    sdk = createSdk({ fetchImpl, sendBeacon: () => true });
  });
  afterEach(() => vi.useRealTimers());

  const init = (over = {}) =>
    sdk.init({ key: 'ml_pub_aebagbafaydqqcik', host: 'https://events.shop.cz', ...over });

  /** Události z dávky odeslané tímhle SDK, ne z dávky nějaké starší instance. */
  const namesFrom = (index = 0): string[] =>
    (requests[index]!.body as { events: { name: string }[] }).events.map((e) => e.name);

  it('bez consent nezapíše do prohlížeče nic a neodešle žádný požadavek', async () => {
    init();
    sdk.track('product_viewed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(0);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('ml_aid');
  });

  it('po consent se odešle session_started a page_view v jedné dávce', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('session_started');
    expect(namesFrom()).toContain('page_view');
  });

  it('po odvolání souhlasu zmizí ml_aid z cookie i localStorage', () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(localStorage.getItem('ml_aid')).not.toBeNull();
    sdk.consent({ analytics: false, personalization: false });
    expect(localStorage.getItem('ml_aid')).toBeNull();
    expect(document.cookie).not.toContain('ml_aid');
  });

  it('neplatné jméno události se zahodí a nikdy nevyhodí výjimku do stránky', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(() => sdk.track('Product Viewed')).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).not.toContain('Product Viewed');
  });

  it('dvě page_view na tutéž cestu do jedné sekundy se počítají jednou', async () => {
    init({ autoPageView: false });
    sdk.consent({ analytics: true, personalization: true });
    sdk.page();
    sdk.page();
    await vi.advanceTimersByTimeAsync(5000);
    const mine = requests.filter((r) =>
      JSON.stringify(r.body).includes('"key":"ml_pub_aebagbafaydqqcik"'),
    );
    const names = mine.flatMap((r) =>
      (r.body as { events: { name: string }[] }).events.map((e) => e.name),
    );
    expect(names.filter((name) => name === 'page_view')).toHaveLength(1);
  });

  it('pushState vyvolá nové page_view', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    requests.length = 0;
    window.history.pushState({}, '', '/novinky');
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('page_view');
  });

  it('identify s e-mailem bez podpisu se do dávky vůbec nedostane', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    sdk.identify('customer_8472', { email: 'a@b.cz' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).not.toContain('a@b.cz');
  });

  it('identify s podpisem e-mail předá', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    sdk.identify('customer_8472', { email: 'a@b.cz' }, { signature: 'c2ln' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).toContain('a@b.cz');
  });

  it('reset vygeneruje nové anonymous_id', () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    const before = sdk.getAnonymousId();
    sdk.reset();
    expect(sdk.getAnonymousId()).not.toBe(before);
  });

  it('ml_token zmizí z adresního řádku a utm parametry v ní zůstanou', async () => {
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej?ml_token=t1abc&utm_source=news');
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(window.location.search).not.toContain('ml_token');
    expect(window.location.search).toContain('utm_source=news');
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.find((r) => r.url.endsWith('/e/identify'))).toBeDefined();
  });

  it('bez souhlasu s personalization se ml_token zahodí a neodešle', async () => {
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej?ml_token=t1abc');
    init();
    sdk.consent({ analytics: true, personalization: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.find((r) => r.url.endsWith('/e/identify'))).toBeUndefined();
  });

  it('fronta z window.Mlain.q se po načtení přehraje', async () => {
    (window as unknown as { Mlain: { q: unknown[] } }).Mlain = {
      q: [
        ['init', { key: 'ml_pub_aebagbafaydqqcik', host: 'https://events.shop.cz' }],
        ['consent', { analytics: true, personalization: true }],
      ],
    };
    createSdk({ fetchImpl, sendBeacon: () => true }).bootstrap();
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.length).toBeGreaterThan(0);
  });

  it('nová session po 30 minutách nečinnosti odešle další session_started', async () => {
    init({ sessionTimeoutMinutes: 30 });
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    sdk.track('product_viewed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('session_started');
  });

  it('SDK nikdy nečte hodnoty z formulářových polí', async () => {
    const field = document.createElement('input');
    field.id = 'pole';
    field.value = 'tajná hodnota';
    document.body.appendChild(field);
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).not.toContain('tajná hodnota');
    field.remove();
  });
});
