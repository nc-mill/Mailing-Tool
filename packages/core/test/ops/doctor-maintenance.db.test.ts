import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withAdminTx } from '../../src/ops/db';
import { maintenanceChecks } from '../../src/ops/doctor/checks-maintenance';
import { recordPartitionMaintenance } from '../../src/ops/partition-retention';
import type { DoctorContext } from '../../src/ops/doctor/types';
import { startTestPostgres, type TestPostgres } from '../support/db';

let pg: TestPostgres;

const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  dataDir: '/tmp',
  backupDir: '/tmp',
  uploadsDir: '/tmp',
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
  imageVersion: '1.0.0',
  now: new Date(),
  ...over,
});

const run = async (context: DoctorContext = ctx()) =>
  (await Promise.all(maintenanceChecks.map((check) => check(context)))).flat();

/** Jeden běh údržby, kterou nic nezahodilo. To je běžný a správný výsledek. */
const emptyReport = () => ({ dryRun: false, created: [], targets: [] });

/**
 * `audit_log` je partitionovaný po měsících a testovací šablona má oddíly jen
 * dopředu. Test, který zapisuje záznamy staré několik dní, tedy prvního v měsíci
 * spadne na „no partition of relation audit_log found for row", a spadne jen
 * někdy, což je ten nejhorší druh vrtkavého testu. Oddíl minulého měsíce se
 * proto založí předem, se stejným pojmenováním, jaké má `partitionName`.
 */
async function ensurePreviousMonthPartition(): Promise<void> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const name = `audit_log_y${start.getUTCFullYear()}m${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  await pg.sql(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF audit_log
       FOR VALUES FROM (TIMESTAMPTZ '${start.toISOString().slice(0, 10)} 00:00:00+00')
                    TO (TIMESTAMPTZ '${end.toISOString().slice(0, 10)} 00:00:00+00')`,
  );
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 1 });
  await ensurePreviousMonthPartition();
}, 240_000);

beforeEach(async () => {
  await pg.sql(
    "DELETE FROM audit_log WHERE action IN ('partition.maintained', 'backup.created', 'backup.verified')",
  );
});

afterAll(async () => {
  await pg?.stop();
});

describe('údržba oddílů proti skutečné databázi', () => {
  it('bez záznamu hlásí, že úklid nikdy neproběhl', async () => {
    const findings = await run();
    expect(findings.map((f) => f.id)).toEqual(['no_partition_maintenance_yet']);
  });

  it('po zápisu z mlain partitions je nález pryč', async () => {
    await withAdminTx(pg.ownerUrl, async (tx) => {
      await recordPartitionMaintenance(tx, emptyReport());
    });
    const written = await pg.sql<{ actor_label: string; metadata: Record<string, unknown> }>(
      "SELECT actor_label, metadata FROM audit_log WHERE action = 'partition.maintained'",
    );
    expect(written).toHaveLength(1);
    expect(written[0]?.actor_label).toBe('mlain partitions');
    expect(written[0]?.metadata).toEqual({ created: 0, dropped: 0, tables: {} });

    expect(await run()).toEqual([]);
  });

  /**
   * Jádro celého nálezu: záznam v tabulce sám o sobě nikoho neupozorní.
   * Teprve tenhle případ znamená, že se provozovatel dozví, že mu úklid
   * přestal běžet a data leží přes lhůtu.
   */
  it('záznam starší než dva dny zežloutne', async () => {
    await pg.sql(`
      INSERT INTO audit_log (workspace_id, actor_type, actor_label, action, created_at)
      VALUES (NULL, 'system', 'mlain partitions', 'partition.maintained', now() - interval '3 days')
    `);
    const findings = await run();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'partition_maintenance_stale',
      severity: 'warning',
    });
  });

  it('rozhoduje NEJNOVĚJŠÍ záznam, ne ten první nalezený', async () => {
    // Instalace, která běží dlouho, má v auditu desítky starých záznamů.
    // Kdyby se dotaz ptal špatně, hlásil by poruchu na fungující instalaci.
    // Časy zůstávají uvnitř aktuálního měsíčního oddílu schválně: audit_log je
    // partitionovaný a testovací šablona nemá oddíly do minulosti.
    await pg.sql(`
      INSERT INTO audit_log (workspace_id, actor_type, actor_label, action, created_at)
      VALUES (NULL, 'system', 'mlain partitions', 'partition.maintained', now() - interval '5 days'),
             (NULL, 'system', 'mlain partitions', 'partition.maintained', now() - interval '3 days'),
             (NULL, 'system', 'mlain partitions', 'partition.maintained', now() - interval '1 hour')
    `);
    expect(await run()).toEqual([]);
  });

  /**
   * Mlčení a „vše v pořádku" vypadají v doktoru stejně. Kontrola bez migrátora
   * proto nesmí vrátit prázdný seznam: provozovatel by z výstupu četl, že mu
   * úklid běží, přestože se ho nikdo nezeptal.
   */
  it('bez DATABASE_URL_MIGRATOR hlásí nezjištěno, ne v pořádku', async () => {
    const findings = await run(ctx({ adminUrl: null }));
    // Obě kontroly v tomhle souboru čtou audit pod migrátorem, takže bez něj
    // musí obě říct „nezjištěno". Kdyby jedna z nich mlčela, vypadala by
    // v souhrnu jako v pořádku.
    expect(findings.map((f) => f.id)).toEqual(['check_failed', 'check_failed']);
  });
});

describe('ověřování záloh proti skutečné databázi', () => {
  const insertAudit = (action: string, interval: string, metadata = '{}') =>
    pg.sql(`
      INSERT INTO audit_log (workspace_id, actor_type, actor_label, action, created_at, metadata)
      VALUES (NULL, 'system', 'platform.backup', '${action}', now() - interval '${interval}',
              '${metadata}'::jsonb)
    `);
  const verifiedOk = (interval: string) =>
    insertAudit('backup.verified', interval, '{"ok": true, "problems": []}');

  /** Aby nález o oddílech nepřekážel: tenhle blok hlídá druhou kontrolu. */
  const maintained = () =>
    withAdminTx(pg.ownerUrl, async (tx) => {
      await recordPartitionMaintenance(tx, emptyReport());
    });

  it('instalace bez jediné zálohy tenhle nález nemá', async () => {
    await maintained();
    expect(await run()).toEqual([]);
  });

  it('instalace, která zálohuje přes dva týdny a nikdy neověřovala, dostane nález', async () => {
    await maintained();
    await insertAudit('backup.created', '20 days');
    const findings = await run();
    expect(findings.map((f) => f.id)).toEqual(['no_backup_verify_yet']);
  });

  it('po ověření je nález pryč', async () => {
    await maintained();
    await insertAudit('backup.created', '20 days');
    await verifiedOk('2 days');
    expect(await run()).toEqual([]);
  });

  it('rozhoduje NEJNOVĚJŠÍ ověření, ne to první nalezené', async () => {
    // Instalace, která běží roky, má v auditu desítky starých ověření.
    // Kdyby dotaz bral minimum, hlásil by poruchu na fungující instalaci.
    await maintained();
    await insertAudit('backup.created', '25 days');
    await verifiedOk('22 days');
    await verifiedOk('15 days');
    await verifiedOk('1 hour');
    expect(await run()).toEqual([]);
  });

  it('ověření starší než dva týdny zežloutne', async () => {
    await maintained();
    await insertAudit('backup.created', '25 days');
    await verifiedOk('20 days');
    const findings = await run();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'backup_verify_stale', severity: 'warning' });
  });

  /**
   * Úloha zapisuje záznam i u NEÚSPĚŠNÉHO ověření, takže instalace, které se
   * ověření každou neděli nepovede, má záznam čerstvý a podle stáří by vypadala
   * v pořádku. Tenhle test hlídá, že se výsledek opravdu čte z metadat, ne že
   * se jen předpokládá.
   */
  it('čerstvé ověření s ok=false je nález, ne ticho', async () => {
    await maintained();
    await insertAudit('backup.created', '25 days');
    await insertAudit(
      'backup.verified',
      '1 hour',
      '{"ok": false, "problems": ["contacts: 10 != 12"]}',
    );
    const findings = await run();
    expect(findings.map((f) => f.id)).toEqual(['backup_verify_failed']);
  });
});
