import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load';
import { configVariableNames } from '../../src/config/schema';

let tmp: string;
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-defaults-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('výchozí hodnoty prošly transformací', () => {
  it('žádná výchozí hodnota není nepřevedený řetězec z prostředí', () => {
    const config = loadConfig(MINIMAL()) as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue;
      expect(
        ['true', 'false', '1', '0'],
        `${name} má výchozí hodnotu jako řetězec "${value}". V zodu 4 default() NEPROCHÁZÍ transformací, takže envBool().default('false') vrátí řetězec, který je pravdivostně true. Použij prefault().`,
      ).not.toContain(value);
      expect(
        value.includes(','),
        `${name} má výchozí hodnotu jako řetězec se seznamem "${value}". envCsv().default() nevrací pole. Použij prefault().`,
      ).toBe(false);
    }
  });

  it('booleovské proměnné jsou opravdu boolean a mají správnou hodnotu', () => {
    const config = loadConfig(MINIMAL());
    // Kdyby tyhle dvě byly řetězec 'false', byly by pravdivostně TRUE, tedy
    // metriky veřejné a země ukládaná, aniž by to kdokoli zapnul.
    expect(config.METRICS_ENABLED).toBe(false);
    expect(config.TRACKING_STORE_COUNTRY).toBe(false);
    expect(config.TRACKING_ALLOW_IP_STORAGE).toBe(false);
    expect(config.WEBHOOK_ALLOW_PRIVATE_TARGETS).toBe(false);
    expect(config.MIGRATE_ON_START).toBe(true);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('seznamy jsou opravdu pole', () => {
    const config = loadConfig(MINIMAL());
    expect(config.SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(config.SECRET_KEY_PREVIOUS).toEqual([]);
    expect(config.BRAND_FETCH_ALLOWED_HOSTS).toEqual([]);
    expect(config.BRAND_FETCH_BLOCKED_HOSTS).toEqual([
      'metadata.google.internal',
      'metadata.goog',
      'instance-data',
      'metadata',
    ]);
  });

  it('schéma má právě 183 proměnných (registr je uzavřený, uzávěr S12)', () => {
    // Exaktní číslo je záměr. Doménový plán proměnnou nezakládá, takže každá
    // změna musí projít změnou plánu P01, ne commitem z jiné větve.
    //
    // Ze 179 na 180: DATABASE_URL_MAINTENANCE, připojení pro systémové skeny
    // napříč projekty (nález I82). Bez něj se naplánovaná kampaň neodešle.
    // Ze 180 na 181: DATABASE_URL_GDPR.
    // Ze 181 na 182: LOGIN_THROTTLING_DISABLED, vývojářský vypínač brzd
    // přihlašování. V produkci ho `cross-checks.ts` odmítá, viz tam.
    // Ze 182 na 183: TRACKING_CONTACT_LOOKUP_TIMEOUT_MS. Strop dohledání
    // kontaktu při prokliku byl napsaný natvrdo na 30 ms a měření ho neuneslo:
    // do stropu spadá i otevření spojení, které samo zabralo 26 až 42 ms.
    expect(configVariableNames()).toHaveLength(183);
  });

  it('zná proměnné, které si vyžádal plán P10', () => {
    const names = new Set(configVariableNames());
    for (const name of [
      'TRACKING_ALLOW_IP_STORAGE',
      'RATE_LIMIT_IDENTIFY_IP',
      'RATE_LIMIT_TRACK_ANON',
    ]) {
      expect(names.has(name), `chybí ${name}`).toBe(true);
    }
  });
});
