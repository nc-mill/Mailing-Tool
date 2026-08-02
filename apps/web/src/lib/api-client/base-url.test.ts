import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tenhle soubor vznikl kvůli konkrétní produkční vadě, ne pro pokrytí.
 *
 * `getApiBaseUrl()` vracelo `APP_URL` i pro volání ze serveru. `APP_URL` je ale
 * adresa pro PROHLÍŽEČ, kdežto serverová akce běží uvnitř kontejneru, kde
 * neplatí: aplikace tam poslouchá na `PORT`, zatímco `APP_URL` nese port
 * namapovaný na hostiteli, nebo rovnou veřejnou doménu za reverzní proxy.
 *
 * Projevilo se to až v produkční image s jiným vnějším portem než vnitřním:
 * dokončení průvodce vrátilo 503 a uživatel viděl „Server neodpovídá".
 * S vnějším portem shodným s vnitřním to prochází NÁHODOU, což je přesně ten
 * důvod, proč to nikdo dřív nezachytil.
 */

const nastavConfig = (hodnoty: { APP_URL: string; PORT: number }) => {
  vi.doMock('@/lib/runtime', () => ({ getConfig: () => hodnoty }));
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/runtime');
  vi.unstubAllGlobals();
});

describe('getApiBaseUrl na serveru', () => {
  // Testy `apps/web` běží v jsdom, kde `window` existuje vždycky. Serverové
  // chování se proto musí vyrobit jeho odebráním, jinak by se tahle větev
  // nikdy neproměřila a testy by mlčky kontrolovaly jen prohlížeč.
  beforeEach(() => {
    vi.stubGlobal('window', undefined);
  });

  it('míří na loopback s VNITŘNÍM portem, ne na APP_URL', async () => {
    nastavConfig({ APP_URL: 'https://mail.firma.cz', PORT: 3000 });
    const { getApiBaseUrl } = await import('./base-url');

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:3000');
  });

  it('nepoužije veřejnou doménu ani port z APP_URL', async () => {
    // Tvar běžného nasazení: zvenčí 4600, uvnitř 3000. Kdyby se vrátilo
    // cokoli z `APP_URL`, spojení uvnitř kontejneru nikam nevede.
    nastavConfig({ APP_URL: 'http://localhost:4600', PORT: 3000 });
    const { getApiBaseUrl } = await import('./base-url');

    const base = getApiBaseUrl();
    expect(base).not.toContain('4600');
    expect(base).not.toContain('localhost');
    expect(base).toBe('http://127.0.0.1:3000');
  });

  it('respektuje nestandardní PORT', async () => {
    nastavConfig({ APP_URL: 'https://mail.firma.cz', PORT: 8080 });
    const { getApiBaseUrl } = await import('./base-url');

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:8080');
  });
});

describe('getApiBaseUrl v prohlížeči', () => {
  it('vrací prázdný základ, aby požadavek šel na tentýž původ', async () => {
    // Relativní cesta se nemůže rozejít s tím, co uživatel vidí v adresním
    // řádku, ani za reverzní proxy, ani na jiném portu.
    vi.stubGlobal('window', {});
    nastavConfig({ APP_URL: 'https://mail.firma.cz', PORT: 3000 });
    const { getApiBaseUrl } = await import('./base-url');

    expect(getApiBaseUrl()).toBe('');
  });

  it('nesáhne na loopback, ten by z prohlížeče vedl na počítač uživatele', async () => {
    vi.stubGlobal('window', {});
    nastavConfig({ APP_URL: 'https://mail.firma.cz', PORT: 3000 });
    const { getApiBaseUrl } = await import('./base-url');

    expect(getApiBaseUrl()).not.toContain('127.0.0.1');
  });
});
