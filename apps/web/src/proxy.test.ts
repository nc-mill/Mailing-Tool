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

  it('nonce předá dál v hlavičce požadavku, aby ho layout mohl použít', async () => {
    const response = await proxy(request('/login'));
    expect(response.headers.get('x-nonce')).toBeTruthy();
  });

  it('matcher vynechává statické soubory', () => {
    expect(config.matcher).toHaveLength(1);
    const [matcher] = config.matcher;
    const pattern = new RegExp((matcher as string).replace('/((?!', '^/(?!').replace(').*)', ')'));
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
  });
});
