// @vitest-environment node
import os from 'node:os';
import { describe, it, expect } from 'vitest';

/**
 * `authenticate.ts` táhne `rate-limit.ts`, jehož katalog pravidel čte
 * konfiguraci už při vyhodnocení modulu. Prostředí proto musí být hotové dřív
 * a modul se importuje dynamicky až za tímhle blokem, stejně jako
 * v `rate-limit.test.ts`.
 */
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATABASE_URL'] ??= 'postgres://mlain_app:pw@127.0.0.1:5432/mlain';
process.env['DATABASE_URL_MIGRATOR'] ??= 'postgres://mlain_migrator:pw@127.0.0.1:5432/mlain';
process.env['DATA_DIR'] ??= os.tmpdir();
Object.assign(process.env, { NODE_ENV: 'test' });
process.env['MODE'] = 'web';

const { bearerFromHeader, workspaceRefFrom } = await import('./authenticate');

describe('bearerFromHeader', () => {
  it('vyzobne hodnotu za Bearer', () => {
    expect(bearerFromHeader('Bearer ml_live_abc')).toBe('ml_live_abc');
  });

  it('je odolný vůči jinému psaní slova Bearer', () => {
    expect(bearerFromHeader('bearer ml_live_abc')).toBe('ml_live_abc');
  });

  it('bez schématu vrací null, aby se hodnota nezkusila jako klíč', () => {
    expect(bearerFromHeader('ml_live_abc')).toBeNull();
  });

  it('prázdná nebo chybějící hlavička vrací null', () => {
    expect(bearerFromHeader('')).toBeNull();
    expect(bearerFromHeader(undefined)).toBeNull();
  });

  it('Basic se ignoruje', () => {
    expect(bearerFromHeader('Basic dXNlcjpwYXNz')).toBeNull();
  });
});

describe('workspaceRefFrom', () => {
  it('bere hodnotu z hlavičky X-Workspace-Id', () => {
    expect(workspaceRefFrom({ header: 'ws-slug', path: '/api/v1/api-keys' })).toBe('ws-slug');
  });

  it('bez hlavičky použije segment /w/{slug} z cesty', () => {
    expect(workspaceRefFrom({ header: undefined, path: '/w/muj-projekt/settings' })).toBe(
      'muj-projekt',
    );
  });

  it('hlavička má přednost před cestou', () => {
    expect(workspaceRefFrom({ header: 'z-hlavicky', path: '/w/z-cesty/x' })).toBe('z-hlavicky');
  });

  it('bez obojího vrací null', () => {
    expect(workspaceRefFrom({ header: undefined, path: '/api/v1/api-keys' })).toBeNull();
  });
});
