import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Logger } from '../logging/logger';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools } from './index';
import {
  isolationCheck,
  isolationReasons,
  resetIsolationGuardCache,
  warnIfIsolationBroken,
} from './isolation-guard';

/**
 * Test běží proti SKUTEČNÉ databázi a přepíná roli spojení, protože přesně to
 * je předmět kontroly. Zesměšněný pool by ověřil, že se volá funkce, ne že
 * kontrola pozná roli, na kterou se RLS nevztahuje.
 *
 * `mlain_app` je role, pod kterou aplikace běží u zákazníka: nevlastní schéma
 * a nemá BYPASSRLS. `mlain_migrator` schéma vlastní, takže je to přesně ten
 * případ, který se u samohostitele s jedinou rolí stane a dosud si ho nikdo
 * nevšiml.
 */
let harness: PgHarness;

type FakeLogger = {
  calls: { level: 'error' | 'warn'; fields: Record<string, unknown>; message: string }[];
  logger: Logger;
};

function fakeLogger(): FakeLogger {
  const calls: FakeLogger['calls'] = [];
  const record =
    (level: 'error' | 'warn') => (fields: Record<string, unknown>, message: string) => {
      calls.push({ level, fields, message });
    };
  return { calls, logger: { error: record('error'), warn: record('warn') } as unknown as Logger };
}

/** Přepne aplikační spojení na jinou roli. Pooly i konfigurace se drží v modulu. */
async function useRole(url: string): Promise<void> {
  await closePools();
  resetIsolationGuardCache();
  process.env['DATABASE_URL'] = url;
}

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterEach(async () => {
  await useRole(harness.appUrl);
});

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('startovní kontrola izolace projektů', () => {
  it('pod rolí mlain_app nehlásí nic', async () => {
    await useRole(harness.appUrl);
    expect(await isolationReasons()).toEqual([]);

    const log = fakeLogger();
    expect(await warnIfIsolationBroken(log.logger)).toBe(0);
    expect(log.calls).toEqual([]);
    expect(await isolationCheck()()).toEqual({ name: 'isolation', status: 'ok' });
  });

  it('pod rolí, která vlastní schéma, hlásí chybu do logu i do readiness', async () => {
    await useRole(harness.migratorUrl);

    const reasons = await isolationReasons();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ')).toContain('mlain_migrator');

    const log = fakeLogger();
    expect(await warnIfIsolationBroken(log.logger)).toBe(reasons.length);
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.level).toBe('error');
    expect(log.calls[0]!.message).toContain('PROJEKTY NEJSOU IZOLOVANÉ');
    expect(log.calls[0]!.fields['reasons']).toEqual(reasons);

    // Readiness to musí říct taky, ale NESMÍ ji to srazit: instalace s jedním
    // projektem by se jinak dostala do restartové smyčky.
    const result = await isolationCheck()();
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('isolation_prerequisites_missing');
  });

  it('druhý start téhož procesu log nezdvojí', async () => {
    await useRole(harness.migratorUrl);
    const log = fakeLogger();
    await warnIfIsolationBroken(log.logger);
    await warnIfIsolationBroken(log.logger);
    expect(log.calls).toHaveLength(1);
  });

  it('nedostupná databáze start neshodí a netváří se jako pořádek', async () => {
    // Port, na kterém nic neposlouchá. Kontrola se musí ohlásit jako
    // NEPROVEDENÁ, ne jako úspěšná: chyba spojení není důkaz o izolaci.
    await useRole(harness.appUrl.replace(`:${harness.port}/`, ':1/'));

    const log = fakeLogger();
    expect(await warnIfIsolationBroken(log.logger)).toBe(-1);
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]!.level).toBe('warn');

    const result = await isolationCheck()();
    expect(result.status).toBe('skip');
  });
});
