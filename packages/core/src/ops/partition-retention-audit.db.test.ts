import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools } from '../tx';
import { runPartitionMaintenance } from './partition-retention';

/**
 * DŮKAZ, že retence auditu doopravdy běží, a to tou cestou, která na ni má práva.
 *
 * Do 7. 8. 2026 ji dělala fronta `platform.cleanup_audit_log` příkazem
 * `DELETE FROM audit_log` pod aplikační rolí. NIKDY ANI JEDNOU nedoběhla:
 * migrace 0005, 0009, 0022 i 0026 dělají `REVOKE UPDATE, DELETE ON audit_log
 * FROM mlain_app`, takže úloha padala na `permission denied for table audit_log`
 * (SQLSTATE 42501) každou noc, a nikdo si toho čtyři měsíce nevšiml, protože
 * poznámka v `partition-retention.ts` tvrdila, že „běží pod aplikační rolí
 * a funguje".
 *
 * Tenhle soubor drží obě poloviny toho nálezu:
 *  1. pod aplikační rolí to POŘÁD nejde, a jít nemá,
 *  2. pod migrátorem úklid oddílů auditu projde.
 */
let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('retence auditu', () => {
  /**
   * Ta odebraná práva jsou ZÁRUKA, ne překážka. Kdyby je někdo migrací vrátil,
   * aby „šel opravit noční úklid", spadne tenhle test a řekne proč.
   */
  it('aplikační role do auditu mazat NESMÍ, a to je záměr', async () => {
    const client = new pg.Client({ connectionString: harness.appUrl });
    await client.connect();
    try {
      await expect(client.query(`DELETE FROM audit_log`)).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.end();
    }
  });

  it('migrátor projde úklidem auditu bez chyby a hlásí ho jako svůj cíl', async () => {
    const client = new pg.Client({ connectionString: harness.migratorUrl });
    await client.connect();
    try {
      const report = await runPartitionMaintenance({
        client,
        dryRun: true,
        now: new Date('2026-08-07T12:00:00.000Z'),
      });

      const audit = report.targets.find((t) => t.table === 'audit_log');
      expect(audit, 'audit_log není mezi cíli úklidu').toBeDefined();
      expect(audit!.setting).toBe('AUDIT_RETENTION_MONTHS');
      // Hranice oddílů se čte z katalogu (`pg_get_expr(relpartbound)`), takže
      // rozhodnutí vzniklo nad skutečnými oddíly, ne nad odhadem podle jména.
      expect(audit!.decisions.length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });

  /**
   * Čerstvá instalace nesmí o audit přijít. Výchozí lhůta je 24 měsíců a oddíly
   * jsou měsíční, takže dnešní ani žádný existující oddíl zahodit nejde.
   */
  it('nic čerstvého se nezahodí, oddíly zasahují do lhůty', async () => {
    const client = new pg.Client({ connectionString: harness.migratorUrl });
    await client.connect();
    try {
      const report = await runPartitionMaintenance({
        client,
        dryRun: true,
        now: new Date('2026-08-07T12:00:00.000Z'),
      });
      const audit = report.targets.find((t) => t.table === 'audit_log')!;
      expect(audit.decisions.filter((d) => d.drop)).toEqual([]);
      expect(audit.dropped).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
