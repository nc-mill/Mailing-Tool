import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@mlain/core/identity/cookie';
import { config, proxy } from './proxy';

function request(path: string, options: { session?: boolean } = {}) {
  const url = `https://mlain.test${path}`;
  const headers = new Headers();
  if (options.session) headers.set('cookie', `${SESSION_COOKIE_NAME}=abc`);
  return new NextRequest(new Request(url, { headers }));
}

describe('proxy', () => {
  it('nepřihlášeného pošle na přihlášení a zapamatuje si cíl', async () => {
    const response = await proxy(request('/w/eshop-kolo/contacts'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/w/eshop-kolo/contacts');
  });

  it('přihlášeného pustí dál', async () => {
    const response = await proxy(request('/w/eshop-kolo/contacts', { session: true }));
    expect(response.status).toBe(200);
  });

  it('trackovací cesty nepřesměrovává a nekešuje', async () => {
    const response = await proxy(request('/t/o/abc123'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('veřejné stránky pro příjemce nevyžadují přihlášení', async () => {
    for (const path of ['/u/token', '/p/token', '/s/c/token', '/r/token', '/f/newsletter']) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  it('health routy nepřesměrovává, jinak by kontejner hlásil nezdravý stav', async () => {
    for (const path of ['/api/health', '/api/health/ready']) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  // Streamovaný chat asistenta žije mimo /api/v1 a přihlášení si řeší sám.
  // Kdyby ho proxy odbavila, nepřihlášený dostane přesměrování na HTML
  // a přihlášenému jazykové middleware doplní předponu, takže cesta spadne
  // do stromu stránek a klient místo proudu dostane HTML.
  it('interní endpointy neodbavuje ani bez relace, ani s ní', async () => {
    const bezRelace = await proxy(request('/api/internal/ai/chat'));
    expect(bezRelace.status).toBe(200);
    expect(bezRelace.headers.get('location')).toBeNull();

    const sRelaci = await proxy(request('/api/internal/ai/chat', { session: true }));
    expect(sRelaci.status).toBe(200);
    expect(sRelaci.headers.get('location')).toBeNull();
    expect(sRelaci.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('přihlašovací stránka je dostupná bez relace', async () => {
    const response = await proxy(request('/login'));
    expect(response.status).toBe(200);
  });

  it('nastaví bezpečnostní hlavičky včetně CSP s nonce', async () => {
    const response = await proxy(request('/login'));
    const csp = response.headers.get('content-security-policy') as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self'[^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  // Uvolnění pro vývojový React je jediná odchylka v CSP a smí platit VÝHRADNĚ
  // mimo produkci. Kdyby proteklo do produkčního buildu, byla by to trvale
  // otevřená díra, kterou by nikdo nepoznal: stránka by fungovala úplně stejně.
  // Proto se hlídají obě větve, ne jen ta, ve které zrovna běží testy.
  it('produkční CSP nepovoluje vyhodnocování kódu za běhu, vývojová ano', async () => {
    // `process.env.NODE_ENV` je v typech Node jen pro čtení, proto zápis
    // přes indexovaný přístup. Za běhu je to obyčejná proměnná prostředí.
    const env = process.env as Record<string, string | undefined>;
    const puvodni = env['NODE_ENV'];
    try {
      env['NODE_ENV'] = 'production';
      const produkcni = (await proxy(request('/login'))).headers.get(
        'content-security-policy',
      ) as string;
      expect(produkcni).not.toContain('unsafe-eval');
      expect(produkcni).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);

      env['NODE_ENV'] = 'development';
      const vyvojova = (await proxy(request('/login'))).headers.get(
        'content-security-policy',
      ) as string;
      expect(vyvojova).toContain('unsafe-eval');
    } finally {
      env['NODE_ENV'] = puvodni;
    }
  });

  /**
   * Tenhle test dřív jen ověřoval, že `x-nonce` na ODPOVĚDI není prázdný,
   * přestože se jmenoval „předá dál v hlavičce požadavku". Prošel tedy i ve
   * chvíli, kdy nonce k Nextu vůbec nedorazil.
   *
   * Následek byl vážný a čistě produkční: Next si nonce bere z hlaviček
   * POŽADAVKU a razítkuje jím své bootstrapové inline skripty. Bez něj je
   * prohlížeč zablokoval, devětkrát na stránku, a **React se vůbec
   * nenamountoval**. Stránka se vykreslila ze serveru, vypadala hotově, a nic
   * na ní nefungovalo: žádné tlačítko, formulář ani navigace. V dev režimu se
   * to neprojevilo, protože tam má politika `'unsafe-eval'`.
   *
   * Next předává upravené hlavičky požadavku přes `x-middleware-request-*`
   * a jejich seznam v `x-middleware-override-headers`, takže se to dá ověřit
   * přímo na odpovědi middlewaru.
   */
  it('nonce z CSP se SHODUJE s nonce, který dostane Next v hlavičkách požadavku', async () => {
    const response = await proxy(request('/login'));

    const csp = response.headers.get('content-security-policy') ?? '';
    const nalezeny = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    const nonceProProhlizec = nalezeny?.[1];
    expect(nonceProProhlizec, 'CSP neobsahuje nonce').toBeTruthy();

    const prepsane = response.headers.get('x-middleware-override-headers') ?? '';
    expect(prepsane, 'middleware nepředává žádné upravené hlavičky požadavku').toContain('x-nonce');

    const nonceProNext = response.headers.get('x-middleware-request-x-nonce');
    expect(
      nonceProNext,
      'Next nedostane nonce v hlavičkách požadavku, takže své inline skripty neorazítkuje ' +
        'a prohlížeč je zablokuje. Stránka se vykreslí, ale nic na ní nepůjde kliknout.',
    ).toBe(nonceProProhlizec);

    // Tatáž politika musí jít i do požadavku, jinak si ji Next nemá kde přečíst.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
  });

  it('matcher vynechává statické soubory', () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp((matcher as string).replace('/((?!', '^/(?!').replace(').*)', ')'));
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
  });

  /**
   * N5. Hlavní matcher vynechává jakoukoliv cestu s tečkou, jenže token veřejné
   * stránky se na první tečce jen uřízne, takže `/u/TOKEN.x` obslouží tatáž
   * trasa. Vyjmenované cesty jsou pojistka, aby proxy na takovou adresu doběhla;
   * skutečná oprava je v `publicHtmlResponse`.
   */
  it('matcher zná i veřejné cesty s tečkou v tokenu', () => {
    for (const path of ['/u/:path*', '/p/:path*', '/r/:path*', '/v/:path*', '/s/c/:path*']) {
      expect(config.matcher, `chybí ${path}`).toContain(path);
    }
    // Vkládací skript `/f/{ref}.js` tam schválně NENÍ: proxy by mu přepsala
    // `cache-control` na `no-store` a zahodila pětiminutovou cache.
    expect(config.matcher).not.toContain('/f/:path*');
  });

  /**
   * Veřejná stránka běží bez jediného bajtu JavaScriptu, takže si smí dovolit
   * přísnější politiku než aplikace. Kdyby jí proxy vnutila sadu aplikace,
   * měla by tatáž stránka jinou politiku podle toho, jestli je v adrese tečka.
   */
  it('veřejným stránkám dává přísnější politiku než aplikaci', async () => {
    for (const path of ['/u/token', '/p/token', '/s/c/token', '/r/token', '/v/token']) {
      const response = await proxy(request(path));
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).toContain("script-src 'none'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options'), path).toBe('DENY');
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
    }
  });

  /**
   * Hostovaný formulář se vkládá do `<iframe>` na cizí web. Dokud mu proxy
   * posílala `x-frame-options: DENY`, byl ve vloženém rámu zhasnutý všem
   * zákazníkům naráz a v testech to nebylo vidět, protože ty volají handler.
   */
  it('vkládanému formuláři rámování NEZAKAZUJE', async () => {
    for (const path of ['/f/newsletter', '/f/newsletter/thanks']) {
      const response = await proxy(request(path));
      expect(response.headers.get('x-frame-options'), path).toBeNull();
      // Kladné tvrzení: odpověď úplně bez politiky obsahu by u „neobsahuje
      // zákaz" prošla, a přitom je to ta vada, kterou opravujeme.
      expect(response.headers.get('content-security-policy') ?? '', path).toContain(
        'frame-ancestors *',
      );
    }
  });

  it('trackovací cesty a API si nechávají sadu aplikace', async () => {
    for (const path of ['/t/o/abc123', '/api/v1/contacts']) {
      const response = await proxy(request(path));
      expect(response.headers.get('content-security-policy'), path).toContain("default-src 'self'");
    }
  });
});
