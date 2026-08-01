import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConfigError, loadConfig } from '../../src/config/load';

let tmp: string;
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

function messagesFor(env: Record<string, string>): string {
  try {
    loadConfig(env);
    return '';
  } catch (error) {
    return (error as ConfigError).format();
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-cross-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('křížové kontroly konfigurace', () => {
  it('odmítne shodné health porty při MODE=all (kritérium 8c)', () => {
    const text = messagesFor({ ...MINIMAL(), MODE: 'all', SENDER_HEALTH_PORT: '3001' });
    expect(text).toContain('SENDER_HEALTH_PORT');
    expect(text).toMatch(/WORKER_HEALTH_PORT/);
  });

  it('shodné porty při MODE=sender povolí, tam kolize nevzniká', () => {
    // MIGRATE_ON_START musí být false: migrace pouští jen web a all, takže
    // MODE=sender se zapnutými migracemi je sám o sobě chyba konfigurace.
    const config = loadConfig({
      ...MINIMAL(),
      MODE: 'sender',
      MIGRATE_ON_START: 'false',
      SENDER_HEALTH_PORT: '3001',
    });
    expect(config.SENDER_HEALTH_PORT).toBe(3001);
  });

  it('odmítne PORT shodný s WORKER_HEALTH_PORT při MODE=all', () => {
    expect(messagesFor({ ...MINIMAL(), MODE: 'all', PORT: '3001' })).toContain('PORT');
  });

  it('vyžaduje DATABASE_URL_MIGRATOR při MIGRATE_ON_START=true (kritérium 8d)', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'true' });
    expect(text).toContain('DATABASE_URL_MIGRATOR');
  });

  it('bez MIGRATE_ON_START projde start i bez DATABASE_URL_MIGRATOR (kritérium 8d)', () => {
    const config = loadConfig({ ...MINIMAL(), MIGRATE_ON_START: 'false' });
    expect(config.MIGRATE_ON_START).toBe(false);
  });

  it('vyžaduje SENDER_CLAIM_TTL_SECONDS > 4x SENDER_DISPATCH_TIMEOUT_SECONDS', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      SENDER_CLAIM_TTL_SECONDS: '30',
      SENDER_DISPATCH_TIMEOUT_SECONDS: '10',
    });
    expect(text).toContain('SENDER_CLAIM_TTL_SECONDS');
  });

  it('vyžaduje METRICS_TOKEN při METRICS_ENABLED=true', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'false', METRICS_ENABLED: 'true' });
    expect(text).toContain('METRICS_TOKEN');
  });

  it('vyžaduje S3_* při STORAGE_DRIVER=s3', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'false', STORAGE_DRIVER: 's3' });
    for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      expect(text, `chybí ${name}`).toContain(name);
    }
  });

  it('vyžaduje DEFAULT_LOCALE uvnitř SUPPORTED_LOCALES', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      DEFAULT_LOCALE: 'de',
      SUPPORTED_LOCALES: 'cs,en',
    });
    expect(text).toContain('DEFAULT_LOCALE');
  });

  it('vyžaduje SESSION_IDLE_TTL_DAYS <= SESSION_ABSOLUTE_TTL_DAYS', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      SESSION_IDLE_TTL_DAYS: '40',
      SESSION_ABSOLUTE_TTL_DAYS: '30',
    });
    expect(text).toContain('SESSION_IDLE_TTL_DAYS');
  });

  it('vyžaduje CAMPAIGN_QUOTA_RESUME_REMAINING > CAMPAIGN_QUOTA_PAUSE_REMAINING', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      CAMPAIGN_QUOTA_PAUSE_REMAINING: '1000',
      CAMPAIGN_QUOTA_RESUME_REMAINING: '100',
    });
    expect(text).toContain('CAMPAIGN_QUOTA_RESUME_REMAINING');
  });

  it('vyžaduje TRACKING_GEOIP_DB_PATH při TRACKING_STORE_COUNTRY=true', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      TRACKING_STORE_COUNTRY: 'true',
    });
    expect(text).toContain('TRACKING_GEOIP_DB_PATH');
  });

  it('LOG_FORMAT=pretty v produkci je chyba', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      NODE_ENV: 'production',
      LOG_FORMAT: 'pretty',
    });
    expect(text).toContain('LOG_FORMAT');
  });
});
