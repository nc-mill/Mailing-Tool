import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load';

let tmp: string;

// DATABASE_URL_MIGRATOR je v minimální sadě SCHVÁLNĚ. MIGRATE_ON_START je
// ve výchozím stavu true a křížová kontrola z úkolu 10 pak proměnnou vyžaduje.
// Bez ní by deset testů z tohohle a z následujícího úkolu zezelenalo teď
// a spadlo v okamžiku, kdy vznikne cross-checks.ts. Test, který chování bez
// migrátora ověřuje, je v cross-checks.test.ts a používá vlastní sadu.
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: '1:c2VjcmV0LWtleS10aGF0LWlzLTMyLWJ5dGVzLWxvbmc',
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-config-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('projde s minimální sadou a doplní výchozí hodnoty z tabulky 4.9', () => {
    const config = loadConfig(MINIMAL());
    expect(config.MODE).toBe('all');
    expect(config.PORT).toBe(3000);
    expect(config.WORKER_HEALTH_PORT).toBe(3001);
    expect(config.SENDER_HEALTH_PORT).toBe(3002);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_FORMAT).toBe('json');
    expect(config.DEFAULT_LOCALE).toBe('cs');
    expect(config.SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(config.DEFAULT_TIMEZONE).toBe('Europe/Prague');
    expect(config.SIGNUP_MODE).toBe('closed');
    expect(config.SENDER_BATCH_SIZE).toBe(100);
    expect(config.SHUTDOWN_GRACE_SECONDS).toBe(25);
    expect(config.WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(config.MIGRATE_ON_START).toBe(true);
  });

  it('bez SECRET_KEY vyhodí ConfigError s exit code 78 a slovem povinná (kritérium 2)', () => {
    const env = MINIMAL();
    delete env['SECRET_KEY'];
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.exitCode).toBe(78);
      const text = configError.format();
      expect(text).toContain('SECRET_KEY');
      expect(text).toMatch(/povinná|required/);
    }
  });

  it('vypíše VŠECHNY chyby naráz, ne jen první (kritérium 3)', () => {
    // Anotace Record<string, string> je nutná: rozprostření indexovaného typu
    // do objektového literálu index odstraní a delete by se neotypoval.
    const env: Record<string, string> = {
      ...MINIMAL(),
      PORT: '0',
      WORKER_CONCURRENCY: '999',
      LOG_LEVEL: 'shout',
    };
    delete env['APP_URL'];
    delete env['DATABASE_URL'];
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      const text = (error as ConfigError).format();
      for (const name of ['APP_URL', 'DATABASE_URL', 'PORT', 'WORKER_CONCURRENCY', 'LOG_LEVEL']) {
        expect(text, `chybí ${name}`).toContain(name);
      }
      expect((error as ConfigError).issues.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('odmítne ukázkový klíč z dokumentace', () => {
    const env = { ...MINIMAL(), SECRET_KEY: '1:ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('SECRET_KEY musí mít po dekódování přesně 32 bajtů', () => {
    const env = { ...MINIMAL(), SECRET_KEY: '1:c2hvcnQ' };
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      expect((error as ConfigError).format()).toMatch(/32/);
    }
  });

  it('SECRET_KEY_PREVIOUS nemá horní počet položek (3.10)', () => {
    const generation = (id: number) => `${id}:${Buffer.alloc(32, id).toString('base64url')}`;
    const many = Array.from({ length: 200 }, (_, index) => generation(index + 1)).join(',');
    const config = loadConfig({ ...MINIMAL(), SECRET_KEY_PREVIOUS: many });
    expect(config.SECRET_KEY_PREVIOUS).toHaveLength(200);
  });

  it('varianta se sufixem _FILE vyhrává nad přímou hodnotou', () => {
    const secretFile = path.join(tmp, 'secret');
    fs.writeFileSync(secretFile, `1:${Buffer.alloc(32, 7).toString('base64url')}\n`);
    const config = loadConfig({
      ...MINIMAL(),
      SECRET_KEY: '1:c2VjcmV0LWtleS10aGF0LWlzLTMyLWJ5dGVzLWxvbmc',
      SECRET_KEY_FILE: secretFile,
    });
    expect(config.SECRET_KEY.raw).toBe(`1:${Buffer.alloc(32, 7).toString('base64url')}`);
  });

  it('_FILE na neexistující soubor je chyba, ne tiché ignorování', () => {
    expect(() => loadConfig({ ...MINIMAL(), SECRET_KEY_FILE: path.join(tmp, 'chybi') })).toThrow(
      ConfigError,
    );
  });

  it('odmítne DATA_DIR, do kterého nejde zapisovat', () => {
    const readonly = path.join(tmp, 'ro');
    fs.mkdirSync(readonly);
    fs.chmodSync(readonly, 0o500);
    try {
      expect(() => loadConfig({ ...MINIMAL(), DATA_DIR: readonly })).toThrow(ConfigError);
    } finally {
      fs.chmodSync(readonly, 0o700);
    }
  });

  it('odvodí UPLOADS_DIR a BACKUP_DIR z DATA_DIR', () => {
    const config = loadConfig(MINIMAL());
    expect(config.UPLOADS_DIR).toBe(path.join(tmp, 'uploads'));
    expect(config.BACKUP_DIR).toBe(path.join(tmp, 'backups'));
  });

  it('odvodí DATABASE_URL_SENDER z DATABASE_URL při MODE=all', () => {
    const config = loadConfig(MINIMAL());
    expect(config.DATABASE_URL_SENDER).toContain('mlain_sender');
  });

  it('odvodí TRACKING_DOMAIN z APP_URL', () => {
    const config = loadConfig(MINIMAL());
    expect(config.TRACKING_DOMAIN).toBe('mail.example.cz');
  });

  it('APP_URL nesmí mít koncové lomítko', () => {
    expect(() => loadConfig({ ...MINIMAL(), APP_URL: 'https://mail.example.cz/' })).toThrow(
      ConfigError,
    );
  });

  it('WEBHOOK_MAX_ATTEMPTS=9 je odmítnuté (kritérium 36b)', () => {
    expect(() => loadConfig({ ...MINIMAL(), WEBHOOK_MAX_ATTEMPTS: '9' })).toThrow(ConfigError);
    expect(loadConfig({ ...MINIMAL(), WEBHOOK_MAX_ATTEMPTS: '8' }).WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });
});
