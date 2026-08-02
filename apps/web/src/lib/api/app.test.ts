import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { createApiApp } from './app';

// ODCHYLKA OD PLÁNU (nutná): plán psal `import { config } from '@mlain/core/config'`,
// jenže P01 žádný takový singleton neexportuje, vystavuje jen `loadConfig()`
// a apps/web nad ním má líné `getConfig()`. Konfigurace se proto načítá až
// při prvním použití a testy jí musí dát platné prostředí. Tenhle blok NESMÍ
// být nad importy: musí běžet po vyhodnocení modulu `app.js` a před
// `createApiApp()`, což u ESM sedí přesně sem.
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATABASE_URL'] ??= 'postgres://mlain_app:pw@127.0.0.1:5432/mlain';
process.env['DATABASE_URL_MIGRATOR'] ??= 'postgres://mlain_migrator:pw@127.0.0.1:5432/mlain';
process.env['DATA_DIR'] ??= os.tmpdir();
Object.assign(process.env, { NODE_ENV: 'test' });
// Prázdný `MODE` ze shellu projde přes `??=` a zod ho odmítne. Nastavuje se
// proto natvrdo; jinak sada padá na cizím prostředí, ne na testovaném kódu.
process.env['MODE'] = 'web';

const app = createApiApp();

describe('kostra API', () => {
  it('neexistující cesta vrací 404 jako problem+json', async () => {
    const res = await app.request('/api/v1/neexistuje');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await res.json();
    expect(body.code).toBe('not_found');
    expect(body.request_id).toBeTruthy();
  });

  it('vrací X-Request-Id a shoduje se s tělem chyby', async () => {
    const res = await app.request('/api/v1/neexistuje', {
      headers: { 'X-Request-Id': 'abcdefgh' },
    });
    expect(res.headers.get('X-Request-Id')).toBe('abcdefgh');
    expect((await res.json()).request_id).toBe('abcdefgh');
  });

  it('koncové lomítko přesměruje 308 na variantu bez něj', async () => {
    const res = await app.request('/api/v1/__test/ok/');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/v1/__test/ok');
  });

  it('zápis s jiným Content-Type vrací 415', async () => {
    const res = await app.request('/api/v1/__test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'ahoj',
    });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('unsupported_media_type');
  });

  it('tělo nad 1 MiB vrací 413', async () => {
    const res = await app.request('/api/v1/__test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(2 * 1024 * 1024) },
      body: JSON.stringify({ padding: 'x'.repeat(1024) }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('payload_too_large');
  });

  /**
   * Regresní test na skutečnou vadu, ne na domněnku. Undici (Node fetch, kterým
   * `apiMutate` volá tohle API ze serverových akcí) posílá u POST bez těla
   * `Content-Length: 0`; ověřeno přímo v prohlížeči na `/ai/credentials/{id}/test`
   * a `/default`, obě vracely 415, ačkoli neposílaly jediný bajt.
   */
  it('POST bez těla s Content-Length: 0 neprojde jako 415', async () => {
    const res = await app.request('/api/v1/__test/ok', {
      method: 'POST',
      headers: { 'Content-Length': '0' },
    });
    expect(res.status).not.toBe(415);
  });

  it('nepovolená metoda na existující cestě vrací 405', async () => {
    const res = await app.request('/api/v1/__test/ok', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect((await res.json()).code).toBe('method_not_allowed');
  });

  it('výjimka v handleru se nikdy nedostane ven jako stack', async () => {
    const res = await app.request('/api/v1/__test/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('at ');
    expect(JSON.parse(text).code).toBe('internal_error');
  });
});
