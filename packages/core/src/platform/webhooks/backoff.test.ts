import { describe, it, expect } from 'vitest';
import { ConfigSchema, loadConfig } from '../../config';
import { applyUnitEnv } from '../../test-support/unit-env';
import {
  WEBHOOK_BACKOFF_SECONDS,
  JITTER_RATIO,
  delayForAttempt,
  nextAttemptAt,
  isFinalAttempt,
} from './backoff';

/**
 * ODCHYLKA OD PLÁNU: plán importoval hotový objekt `config`. P01 vydává jen
 * `loadConfig()`, takže se konfigurace načte tady a prostředí se doplní
 * `applyUnitEnv()`. Bez toho by `loadConfig()` hodil ConfigError.
 */
applyUnitEnv();
const config = loadConfig();

describe('tabulka odstupů z 3.8', () => {
  it('má osm řádků s přesnými hodnotami', () => {
    expect(WEBHOOK_BACKOFF_SECONDS).toEqual([0, 15, 60, 300, 1800, 7200, 21600, 43200]);
  });

  it('jitter je 20 procent', () => {
    expect(JITTER_RATIO).toBe(0.2);
  });

  it('první pokus jde okamžitě', () => {
    expect(delayForAttempt(1, () => 0.5)).toBe(0);
  });

  it('odstupy bez jitteru odpovídají tabulce', () => {
    const midpoint = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => delayForAttempt(n, midpoint))).toEqual([
      0, 15, 60, 300, 1800, 7200, 21600, 43200,
    ]);
  });

  it('jitter drží hodnotu v pásmu plus minus 20 procent', () => {
    for (let attempt = 2; attempt <= 8; attempt += 1) {
      const base = WEBHOOK_BACKOFF_SECONDS[attempt - 1]!;
      for (let i = 0; i < 200; i += 1) {
        const value = delayForAttempt(attempt, Math.random);
        expect(value).toBeGreaterThanOrEqual(base * 0.8);
        expect(value).toBeLessThanOrEqual(base * 1.2);
      }
    }
  });

  it('pokus nad délku tabulky vrací null, protože pro něj není definované zpoždění', () => {
    expect(delayForAttempt(9, () => 0.5)).toBeNull();
  });
});

describe('nextAttemptAt', () => {
  it('spočítá čas dalšího pokusu od zadaného teď', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const next = nextAttemptAt(1, now, () => 0.5);
    expect(next).not.toBeNull();
    expect(next!.getTime() - now.getTime()).toBe(15_000);
  });

  it('po posledním povoleném pokusu vrací null', () => {
    expect(nextAttemptAt(config.WEBHOOK_MAX_ATTEMPTS, new Date(), () => 0.5)).toBeNull();
  });
});

describe('isFinalAttempt', () => {
  it('poslední pokus podle konfigurace je finální', () => {
    expect(isFinalAttempt(config.WEBHOOK_MAX_ATTEMPTS)).toBe(true);
    expect(isFinalAttempt(config.WEBHOOK_MAX_ATTEMPTS - 1)).toBe(false);
  });
});

/**
 * ODCHYLKA OD PLÁNU, a je podstatná. Plán četl mez jako
 * `ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.maxValue`. Takový test by tvrdil
 * `expect(undefined).toBe(8)` a padal by bez ohledu na to, jestli je mez
 * správně: P01 staví číselné proměnné pomocníkem `envInt(min, max)`, který
 * vrací `union → transform → refine`, a na takovém schématu žádné `maxValue`
 * neexistuje. Ověřeno spuštěním.
 *
 * Mez se proto měří CHOVÁNÍM: hranice se hledá parsováním, ne čtením
 * vnitřního pole schématu. Vazba na délku tabulky se tím ověří stejně tvrdě
 * a test přežije i to, že P01 pomocníka přepíše.
 */
describe('kritérium 36b: mez v konfiguraci se rovná délce tabulky', () => {
  it('horní mez WEBHOOK_MAX_ATTEMPTS je právě počet řádků tabulky', () => {
    const limit = WEBHOOK_BACKOFF_SECONDS.length;
    expect(ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(limit).success).toBe(true);
    expect(ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(limit + 1).success).toBe(false);
  });

  it('hodnota 9 je mimo rozsah, protože pro devátý pokus není definované zpoždění', () => {
    const parsed = ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(9);
    expect(parsed.success).toBe(false);
  });

  it('hodnoty 1, 3 a 8 jsou platné', () => {
    for (const value of [1, 3, 8]) {
      expect(ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(value).success).toBe(true);
    }
  });
});
