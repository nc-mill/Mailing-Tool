import { describe, expect, it } from 'vitest';
import {
  BACKUP_VERIFY_STALE_SECONDS,
  PARTITION_MAINTENANCE_STALE_SECONDS,
  backupVerifyFindings,
  partitionMaintenanceFindings,
} from '../../src/ops/doctor/checks-maintenance';
import type { BackupVerifyState } from '../../src/ops/doctor/checks-maintenance';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('nález o údržbě oddílů', () => {
  it('bez jediného záznamu hlásí, že úklid nikdy neproběhl', () => {
    const findings = partitionMaintenanceFindings(null, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'no_partition_maintenance_yet',
      severity: 'warning',
    });
    // Provozovatel musí z nálezu poznat, co má nastavit, ne jen že něco chybí.
    expect(findings[0]?.action).toContain('mlain partitions');
  });

  it('čerstvý záznam nehlásí nic', () => {
    expect(partitionMaintenanceFindings(ago(3 * 60 * 60), NOW)).toEqual([]);
  });

  /**
   * Jeden vynechaný den je běžná věc: restart stroje, delší upgrade, posunuté
   * okno plánovače. Varování, které chodí planě, se přestane číst, takže je
   * hranice až na dvou dnech.
   */
  it('den a půl starý záznam se ještě nehlásí', () => {
    expect(partitionMaintenanceFindings(ago(36 * 60 * 60), NOW)).toEqual([]);
  });

  it('na hraně dvou dní se hlásí, o vteřinu dřív ne', () => {
    expect(partitionMaintenanceFindings(ago(PARTITION_MAINTENANCE_STALE_SECONDS - 1), NOW)).toEqual(
      [],
    );
    const findings = partitionMaintenanceFindings(ago(PARTITION_MAINTENANCE_STALE_SECONDS), NOW);
    expect(findings[0]).toMatchObject({ id: 'partition_maintenance_stale', severity: 'warning' });
  });

  it('u zastaralého záznamu je v nálezu vidět stáří i přesný čas', () => {
    const findings = partitionMaintenanceFindings(ago(9 * 24 * 60 * 60), NOW);
    expect(findings[0]?.title).toContain('9 dny');
    expect(findings[0]?.detail).toContain('2026-07-29T12:00:00.000Z');
  });
});

const DAY = 24 * 60 * 60;

/** Instalace bez jediné zálohy, do které si každý test doplní, co potřebuje. */
const verify = (over: Partial<BackupVerifyState>) =>
  backupVerifyFindings(
    { lastVerifiedAt: null, lastVerifiedOk: null, firstBackupAt: null, ...over },
    NOW,
  );

/** Instalace, která zálohuje přes rok a naposledy se ÚSPĚŠNĚ ověřila kdysi. */
const verified = (at: Date) =>
  verify({ lastVerifiedAt: at, lastVerifiedOk: true, firstBackupAt: ago(400 * DAY) });

/**
 * Ověření zálohy je JEDINÁ cronová fronta, kterou hlídač ticha ve workeru
 * pokrýt nemůže: tiká týdně a pg-boss maže dokončené úlohy po sedmi dnech,
 * takže z tabulky úloh se delší ticho doložit nedá. Doklad drží audit, proto
 * tenhle nález.
 */
describe('nález o ověřování záloh', () => {
  it('mlčí na instalaci, která ještě nikdy nezálohovala', () => {
    // Tenhle případ patří nálezu `no_backup_yet` v kontrole úložiště. Dvě věty
    // o jednom problému znamenají, že se přestanou číst obě.
    expect(verify({})).toEqual([]);
  });

  it('mlčí na čerstvé instalaci, která zálohuje teprve pár dní', () => {
    // Úloha tiká v neděli, takže „ještě se neověřovalo" je šest dní po nasazení
    // správný stav, ne porucha.
    expect(verify({ firstBackupAt: ago(3 * DAY) })).toEqual([]);
  });

  it('hlásí, že se nikdy neověřovalo, až když instalace zálohuje přes dvě periody', () => {
    expect(verify({ firstBackupAt: ago(BACKUP_VERIFY_STALE_SECONDS - 1) })).toEqual([]);
    const findings = verify({ firstBackupAt: ago(BACKUP_VERIFY_STALE_SECONDS) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'no_backup_verify_yet', severity: 'warning' });
    // Provozovatel musí z nálezu poznat, co má udělat teď hned.
    expect(findings[0]?.action).toContain('mlain backup verify');
  });

  it('čerstvé ověření nehlásí nic, ani po vynechané jedné neděli', () => {
    expect(verified(ago(2 * DAY))).toEqual([]);
    expect(verified(ago(9 * DAY))).toEqual([]);
  });

  it('na hraně dvou týdnů se hlásí, o vteřinu dřív ne', () => {
    expect(verified(ago(BACKUP_VERIFY_STALE_SECONDS - 1))).toEqual([]);
    const findings = verified(ago(BACKUP_VERIFY_STALE_SECONDS));
    expect(findings[0]).toMatchObject({ id: 'backup_verify_stale', severity: 'warning' });
  });

  it('u zastaralého ověření je vidět stáří i přesný čas', () => {
    const findings = verified(ago(30 * DAY));
    expect(findings[0]?.title).toContain('30 dny');
    expect(findings[0]?.detail).toContain('2026-07-08T12:00:00.000Z');
  });

  /**
   * Nejzrádnější případ z celého nálezu. `platform.backup_verify` zapíše
   * auditní záznam i tehdy, když ověření NEPROŠLO, takže instalace, které se
   * ověření každou neděli nepovede, má záznam čerstvý. Podle stáří by vypadala
   * v pořádku, tedy klid odvozený z pravidelně nastávající poruchy.
   */
  it('čerstvé, ale NEÚSPĚŠNÉ ověření je nález, ne ticho', () => {
    const findings = verify({
      lastVerifiedAt: ago(2 * DAY),
      lastVerifiedOk: false,
      firstBackupAt: ago(400 * DAY),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'backup_verify_failed', severity: 'warning' });
  });

  it('neúspěch přebíjí i nález o stáří, aby o jedné poruše nebyly dvě věty', () => {
    const findings = verify({
      lastVerifiedAt: ago(40 * DAY),
      lastVerifiedOk: false,
      firstBackupAt: ago(400 * DAY),
    });
    expect(findings.map((f) => f.id)).toEqual(['backup_verify_failed']);
  });

  it('nečitelný výsledek se bere jako neznámý, ne jako neúspěch', () => {
    // Starý nebo ručně vložený záznam nemusí mít v metadatech klíč `ok`.
    // Tvrdit z chybějícího údaje poruchu by znamenalo hlásit vlastní neznalost.
    expect(
      verify({ lastVerifiedAt: ago(2 * DAY), lastVerifiedOk: null, firstBackupAt: ago(400 * DAY) }),
    ).toEqual([]);
  });
});
