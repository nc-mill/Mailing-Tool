import { beforeEach, describe, expect, it, vi } from 'vitest';
import { partitionMaintenanceJob } from '../../src/ops/jobs/partition-jobs';
import { maintainPartitions } from '../../src/ops/partition-retention';

vi.mock('../../src/ops/partition-retention', () => ({
  maintainPartitions: vi.fn(),
}));

const runner = vi.mocked(maintainPartitions);
const report = { dryRun: false, created: ['messages_y2026m12'], targets: [] };

beforeEach(() => {
  runner.mockReset();
  runner.mockResolvedValue({ report, auditError: null });
});

/**
 * Fronta `platform.maintain_partitions` je jediný důvod, proč dodávaná
 * instalace vůbec něco uklízí: compose žádný plánovač hostitele nemá a na PaaS
 * ho nejde doplnit. Testuje se tady to, co se z běhu nedá poznat.
 */
describe('noční údržba oddílů ve workeru', () => {
  it('běží pod migrátorem a podepíše se do auditu jménem fronty', async () => {
    await partitionMaintenanceJob({ config: { DATABASE_URL_MIGRATOR: 'postgres://m@h/db' } });

    // Popisek aktéra je jediné, čím se v auditu pozná, jestli úklid dělá worker,
    // nebo vlastní cron provozovatele. Bez toho rozdílu se nedá zjistit, který
    // z nich přestal běžet.
    expect(runner).toHaveBeenCalledWith({
      migratorUrl: 'postgres://m@h/db',
      ensureMonths: 4,
      actorLabel: 'platform.maintain_partitions',
    });
  });

  /**
   * Tichý návrat by znamenal, že fronta každou noc hlásí úspěch a neuklízí nic,
   * tedy přesně ten stav, kvůli kterému tahle úloha vznikla. Chybějící proměnná
   * navíc není přechodná porucha: sama se nespraví.
   */
  it('bez DATABASE_URL_MIGRATOR spadne nahlas, místo aby mlčky neuklidila nic', async () => {
    await expect(
      partitionMaintenanceJob({ config: { DATABASE_URL_MIGRATOR: undefined } }),
    ).rejects.toThrow(/DATABASE_URL_MIGRATOR/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('prázdný řetězec se počítá jako chybějící proměnná', async () => {
    // `DATABASE_URL_MIGRATOR=` v .env souboru je běžný způsob, jak proměnnou
    // „vypnout", a prošel by kontrolou na `undefined`.
    await expect(
      partitionMaintenanceJob({ config: { DATABASE_URL_MIGRATOR: '' } }),
    ).rejects.toThrow(/DATABASE_URL_MIGRATOR/);
    expect(runner).not.toHaveBeenCalled();
  });

  /**
   * Úklid v tu chvíli UŽ PROBĚHL, takže se nic neztratilo krom dokladu o něm.
   * Ve workeru je ale tabulka úloh jediné trvalé místo, kde se dá takový
   * problém uvidět: kdyby se chyba spolkla, `mlain doctor` by do dvou dnů
   * hlásil, že údržba neběží, a nikdo by nevěděl proč.
   */
  it('nezapsaný audit shodí úlohu, aby ztracený doklad nebyl neviditelný', async () => {
    runner.mockResolvedValue({ report, auditError: new Error('connection terminated') });
    await expect(
      partitionMaintenanceJob({ config: { DATABASE_URL_MIGRATOR: 'postgres://m@h/db' } }),
    ).rejects.toThrow(/connection terminated/);
  });
});
