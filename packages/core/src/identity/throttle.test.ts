import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { createLogger } from '../logging/logger';
import {
  LOGIN_THROTTLE_RULE_NAMES,
  loginThrottlingDisabled,
  resetLoginThrottlingCache,
  warnIfLoginThrottlingDisabled,
} from './throttle';

let tmp: string;

function configWith(extra: Record<string, string>) {
  return loadConfig({
    APP_URL: 'https://mail.example.cz',
    SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
    DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
    DATA_DIR: tmp,
    MIGRATE_ON_START: 'false',
    // Výchozí NODE_ENV je `production` a tam vypínač neprojde přes křížové
    // kontroly. Vypnuté brzdy jde vůbec načíst jedině mimo produkci, což je
    // samo o sobě další doklad, že pojistka drží.
    NODE_ENV: 'development',
    ...extra,
  });
}

/** Logger se zapisovatelnou dírou, aby šlo číst, co se opravdu vypsalo. */
function capturingLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger(
    { level: 'trace', format: 'json', mode: 'web' },
    { write: (line) => lines.push(line) },
  );
  return { logger, lines };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-throttle-'));
  resetLoginThrottlingCache();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetLoginThrottlingCache();
});

describe('vypínač brzd přihlašování', () => {
  it('bez proměnné jsou brzdy zapnuté', () => {
    expect(loginThrottlingDisabled(configWith({}))).toBe(false);
  });

  it('s LOGIN_THROTTLING_DISABLED=true jsou vypnuté', () => {
    expect(loginThrottlingDisabled(configWith({ LOGIN_THROTTLING_DISABLED: 'true' }))).toBe(true);
  });

  it('vypíná právě pravidla přihlašovacích cest a nic z provozu', () => {
    expect([...LOGIN_THROTTLE_RULE_NAMES].sort()).toEqual([
      'login_ip',
      'login_ip_email',
      'password_reset_ip',
      'setup_ip',
    ]);
    for (const provozni of ['api_key_read', 'api_key_write', 'campaign_send', 'contacts_import']) {
      expect(LOGIN_THROTTLE_RULE_NAMES, `${provozni} se vypínat nesmí`).not.toContain(provozni);
    }
  });
});

describe('hlášení při startu', () => {
  it('se zapnutým vypínačem varuje na úrovni warn a řekne, co neplatí', () => {
    const { logger, lines } = capturingLogger();
    const warned = warnIfLoginThrottlingDisabled(
      logger,
      configWith({ LOGIN_THROTTLING_DISABLED: 'true' }),
    );

    expect(warned).toBe(true);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] as string) as {
      level: number;
      msg: string;
      variable: string;
      disabled: string[];
    };
    // pino: 40 je warn. Nižší úroveň by se v běžném provozu (LOG_LEVEL=info)
    // vůbec nevypsala, což je přesně ten tichý stav, kterému se vyhýbáme.
    expect(record.level).toBe(40);
    expect(record.variable).toBe('LOGIN_THROTTLING_DISABLED');
    expect(record.disabled).toEqual([
      'rate_limit_login_paths',
      'account_lockout',
      'constant_time_floor',
    ]);
    expect(record.msg).toContain('BRZDY PŘIHLAŠOVÁNÍ JSOU VYPNUTÉ');
  });

  it('bez vypínače mlčí', () => {
    const { logger, lines } = capturingLogger();
    expect(warnIfLoginThrottlingDisabled(logger, configWith({}))).toBe(false);
    expect(lines).toEqual([]);
  });

  it('opakované volání log nezdvojí, smí ho tedy volat víc kompozičních kořenů', () => {
    const { logger, lines } = capturingLogger();
    const config = configWith({ LOGIN_THROTTLING_DISABLED: 'true' });
    expect(warnIfLoginThrottlingDisabled(logger, config)).toBe(true);
    expect(warnIfLoginThrottlingDisabled(logger, config)).toBe(false);
    expect(lines).toHaveLength(1);
  });
});
