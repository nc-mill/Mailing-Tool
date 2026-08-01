import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load';
import { configVariableNames } from '../../src/config/schema';

let tmp: string;
// DATABASE_URL_MIGRATOR viz poznámka v load.test.ts: bez ní by křížová
// kontrola MIGRATE_ON_START shodila každý test v tomhle souboru.
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-domains-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('doménové konfigurační proměnné', () => {
  it('zná proměnné všech pěti částí, které je zavádějí', () => {
    const names = new Set(configVariableNames());
    for (const name of [
      'CONTACT_FIELD_LIMIT',
      'IMPORT_MAX_ROWS',
      'SEGMENT_PREVIEW_TIMEOUT_MS',
      'GDPR_EXPORT_TTL_DAYS',
      'ASSET_QUOTA_MB',
      'BRAND_FETCH_ENABLED',
      'AI_ENABLED',
      'TEMPLATE_VERSION_MAX_UNPINNED',
      'CAMPAIGN_MAX_RECIPIENTS',
      'DELIVERABILITY_BOUNCE_GUARD_RATE',
      'SNS_CERT_CACHE_SECONDS',
      'AMBIGUOUS_DISPATCH_POLICY_SES',
      'TRACKING_RETENTION_MONTHS',
      'TRACKING_PROPERTIES_MAX_DEPTH',
    ]) {
      expect(names.has(name), `chybí ${name}`).toBe(true);
    }
  });

  it('má výchozí hodnoty přesně podle tabulek specifikací', () => {
    const config = loadConfig(MINIMAL());
    // Část 2
    expect(config.CONTACT_FIELD_LIMIT).toBe(100);
    expect(config.CONTACT_INDEXED_FIELD_LIMIT).toBe(8);
    expect(config.CONTACT_ATTRIBUTES_MAX_BYTES).toBe(262144);
    expect(config.IMPORT_MAX_FILE_BYTES).toBe(209715200);
    expect(config.IMPORT_BATCH_SIZE).toBe(1000);
    expect(config.IMPORT_STALE_MINUTES).toBe(10);
    expect(config.SEGMENT_PREVIEW_TIMEOUT_MS).toBe(3000);
    expect(config.RETENTION_MIN_DAYS).toBe(1);
    // Část 3
    expect(config.ASSET_QUOTA_MB).toBe(2048);
    expect(config.ASSET_MAX_UPLOAD_MB).toBe(10);
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.BRAND_FETCH_ALLOW_HTTP).toBe(true);
    expect(config.BRAND_FETCH_ALLOW_PRIVATE_NETWORKS).toBe(false);
    expect(config.BRAND_FETCH_BLOCKED_HOSTS).toEqual([
      'metadata.google.internal',
      'metadata.goog',
      'instance-data',
      'metadata',
    ]);
    expect(config.AI_ENABLED).toBe(true);
    expect(config.AI_RATE_PER_HOUR).toBe(60);
    expect(config.TEMPLATE_VERSION_MAX_UNPINNED).toBe(50);
    // Část 4a
    expect(config.AMBIGUOUS_DISPATCH_POLICY_SES).toBe('fail');
    expect(config.AMBIGUOUS_DISPATCH_POLICY_SMTP).toBe('retry');
    expect(config.CAMPAIGN_MAX_RECIPIENTS).toBe(2000000);
    expect(config.CAMPAIGN_UNDO_WINDOW_SECONDS).toBe(60);
    expect(config.DELIVERABILITY_BOUNCE_GUARD_RATE).toBeCloseTo(0.08);
    expect(config.DELIVERABILITY_COMPLAINT_GUARD_RATE).toBeCloseTo(0.003);
    expect(config.MESSAGE_RETENTION_DAYS).toBe(90);
    expect(config.SNS_STORE_RAW_EVENTS).toBe(true);
    // Část 5
    expect(config.TRACKING_RETENTION_MONTHS).toBe(37);
    expect(config.TRACKING_IDENTITY_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.TRACKING_STORE_COUNTRY).toBe(false);
    expect(config.TRACKING_PROPERTIES_MAX_KEYS).toBe(32);
    expect(config.TRACKING_WRITER_BATCH).toBe(500);
  });

  it('AMBIGUOUS_DISPATCH_POLICY_SES je fail, protože SES přepisuje Message-ID', () => {
    expect(loadConfig(MINIMAL()).AMBIGUOUS_DISPATCH_POLICY_SES).toBe('fail');
  });

  it('float se validuje jako číslo v intervalu, ne jako řetězec', () => {
    expect(() => loadConfig({ ...MINIMAL(), DELIVERABILITY_BOUNCE_GUARD_RATE: '1.5' })).toThrow();
    // Křížová kontrola z úkolu 10 vyžaduje varovný práh pod brzdou, takže se
    // s nulovou brzdou musí na nulu srovnat i varování. Bez toho by test
    // ověřoval typ floatu a padal na nesouvisející křížové kontrole.
    expect(
      loadConfig({
        ...MINIMAL(),
        DELIVERABILITY_BOUNCE_GUARD_RATE: '0',
        DELIVERABILITY_BOUNCE_WARN_RATE: '0',
      }).DELIVERABILITY_BOUNCE_GUARD_RATE,
    ).toBe(0);
  });

  it('nezná žádnou proměnnou pro otisky suppression listu', () => {
    const names = configVariableNames();
    expect(names).not.toContain('SUPPRESSION_HASH_KEY');
  });

  it('nezná HEALTH_PORT, platí rozdělení na worker a sender (rozhodnutí D6)', () => {
    expect(configVariableNames()).not.toContain('HEALTH_PORT');
  });
});
