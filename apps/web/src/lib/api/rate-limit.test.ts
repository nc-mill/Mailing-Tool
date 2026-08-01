import os from 'node:os';
import { describe, it, expect, beforeEach } from 'vitest';
import type { ApiError } from '@mlain/core/errors/api-error';

// Katalog čte konfiguraci (RATE_LIMIT_API_READ a _WRITE), a ta se v `apps/web`
// načítá líně přes `getConfig()`. Prostředí proto musí být hotové dřív, než se
// modul vyhodnotí, takže se importuje dynamicky až za tímhle blokem.
process.env['APP_URL'] ??= 'https://mlain.test';
process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
process.env['DATABASE_URL'] ??= 'postgres://mlain_app:pw@127.0.0.1:5432/mlain';
process.env['DATABASE_URL_MIGRATOR'] ??= 'postgres://mlain_migrator:pw@127.0.0.1:5432/mlain';
process.env['DATA_DIR'] ??= os.tmpdir();
Object.assign(process.env, { NODE_ENV: 'test' });
process.env['MODE'] = 'web';

const { RATE_LIMIT_RULES, createLimiterRegistry, consumeAll } = await import('./rate-limit');

describe('katalog limitů', () => {
  it('obsahuje právě ta pravidla, která patří P04 a doménám s API klíčem', () => {
    expect(Object.keys(RATE_LIMIT_RULES).sort()).toEqual([
      'api_key_read',
      'api_key_write',
      'campaign_send',
      'contacts_import',
      'login_ip',
      'login_ip_email',
      'password_reset_ip',
      'session_user',
      'setup_ip',
    ]);
  });

  it('bezpečnostní limity nejsou konfigurovatelné', () => {
    expect(RATE_LIMIT_RULES.login_ip.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.login_ip_email.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.password_reset_ip.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.setup_ip.configurable).toBe(false);
  });

  it('má hodnoty přesně podle tabulky 4.5', () => {
    expect(RATE_LIMIT_RULES.login_ip).toMatchObject({ points: 20, durationSec: 300 });
    expect(RATE_LIMIT_RULES.login_ip_email).toMatchObject({ points: 5, durationSec: 300 });
    expect(RATE_LIMIT_RULES.password_reset_ip).toMatchObject({ points: 5, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.setup_ip).toMatchObject({ points: 10, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.session_user).toMatchObject({ points: 600, durationSec: 60 });
    expect(RATE_LIMIT_RULES.contacts_import).toMatchObject({ points: 10, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.campaign_send).toMatchObject({ points: 30, durationSec: 3600 });
  });
});

describe('consumeAll', () => {
  let registry: ReturnType<typeof createLimiterRegistry>;

  beforeEach(() => {
    registry = createLimiterRegistry({ backend: 'memory', enabled: true });
  });

  it('pod limitem projde a vrátí hlavičky i při úspěchu', async () => {
    const headers = await consumeAll(registry, [{ rule: 'login_ip', key: '1.2.3.4' }]);
    expect(headers['RateLimit-Limit']).toBe('20');
    expect(Number(headers['RateLimit-Remaining'])).toBe(19);
    expect(Number(headers['RateLimit-Reset'])).toBeGreaterThan(0);
  });

  it('nad limitem hodí rate_limited s Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|a@b.cz' }]);
    }
    try {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|a@b.cz' }]);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('rate_limited');
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBeGreaterThan(0);
    }
  });

  it('různé klíče se nepočítají dohromady', async () => {
    for (let i = 0; i < 5; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: `1.2.3.4|user${i}@b.cz` }]);
    }
    await expect(
      consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|user9@b.cz' }]),
    ).resolves.toBeTruthy();
  });

  it('vypnutý limiter propouští všechno', async () => {
    const off = createLimiterRegistry({ backend: 'memory', enabled: false });
    for (let i = 0; i < 100; i += 1) {
      await consumeAll(off, [{ rule: 'login_ip_email', key: 'x' }]);
    }
    await expect(consumeAll(off, [{ rule: 'login_ip_email', key: 'x' }])).resolves.toEqual({});
  });

  it('při víc pravidlech vrátí hlavičky toho s nejmenším zbytkem', async () => {
    for (let i = 0; i < 3; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: 'k' }]);
    }
    const headers = await consumeAll(registry, [
      { rule: 'login_ip', key: 'ip' },
      { rule: 'login_ip_email', key: 'k' },
    ]);
    expect(headers['RateLimit-Limit']).toBe('5');
  });
});
