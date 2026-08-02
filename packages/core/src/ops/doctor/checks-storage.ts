import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { listBackups } from '../backup';
import { withAdminTx } from '../db';
import { binaryMajorVersion } from '../run-process';
import { cannotRun, type DoctorCheck, type DoctorFinding } from './types';

const REQUIRED_BINARIES = ['pg_dump', 'pg_restore', 'createdb', 'dropdb'] as const;
const REQUIRED_MAJOR = 18;
const BACKUP_STALE_DAYS = 7;

/**
 * Záměna `/var/lib/postgresql` a `/var/lib/postgresql/data` u image řady 18
 * znamená, že data leží uvnitř kontejneru a po `docker compose down` zmizí.
 * Pozná se to tak, že svazek na hostiteli zůstane prázdný, přestože databáze
 * běží a má data. Bez téhle kontroly se na to přijde až prvním restartem.
 */
export async function checkDataVolume(
  dataDir: string,
  installationHasData: boolean,
): Promise<DoctorFinding | null> {
  if (!installationHasData) return null;
  const entries = await readdir(dataDir).catch(() => null);
  if (entries !== null && entries.length > 0) return null;
  return {
    id: 'data_volume_empty',
    severity: 'critical',
    title: `Datový svazek ${dataDir} je prázdný, přestože instalace má data`,
    detail:
      'Typická příčina je záměna cesty svazku u image postgres řady 18: data se zapisují dovnitř ' +
      'kontejneru místo na hostitele. Po docker compose down zmizí všechno.',
    action:
      'Zkontrolujte mapování svazku v compose souboru podle kapitoly 3.12 části 1 a hned potom ' +
      'spusťte mlain backup.',
  };
}

export async function checkBackupFreshness(
  backupDir: string,
  now: Date,
  installationHasData: boolean,
): Promise<DoctorFinding | null> {
  if (!installationHasData) return null;
  const entries = await listBackups(backupDir);
  const newest = entries[0];
  if (newest === undefined) {
    return {
      id: 'no_backup_yet',
      severity: 'warning',
      title: 'Instalace má data, ale žádnou zálohu',
      detail: `V adresáři ${backupDir} není jediná záloha ve tvaru mlain-<čas>Z.`,
      action: 'Spusťte mlain backup a nechte zapnutou plánovanou zálohu přes BACKUP_SCHEDULE_CRON.',
    };
  }
  const ageDays = Math.floor((now.getTime() - newest.createdAt.getTime()) / 86_400_000);
  if (ageDays < BACKUP_STALE_DAYS) return null;
  return {
    id: 'backup_stale',
    severity: 'warning',
    title: `Poslední záloha je stará ${ageDays} dní`,
    detail: `Nejnovější je ${newest.name}.`,
    action: 'Spusťte mlain backup a ověřte, že plánovaná záloha běží.',
  };
}

const checkBinaries: DoctorCheck = async () => {
  const findings: DoctorFinding[] = [];
  for (const bin of REQUIRED_BINARIES) {
    const major = await binaryMajorVersion(bin);
    if (major === null) {
      findings.push({
        id: 'backup_binary_missing',
        severity: 'critical',
        title: `Binárka ${bin} není dostupná`,
        detail: 'Bez ní nejde vytvořit ani ověřit zálohu, takže instalace nemá jak zálohovat.',
        action: 'Doplňte do image balík postgresql18-client.',
      });
    } else if (major !== REQUIRED_MAJOR) {
      findings.push({
        id: 'backup_binary_version_mismatch',
        severity: 'critical',
        title: `Binárka ${bin} je major verze ${major}, čeká se ${REQUIRED_MAJOR}`,
        detail: 'Starší pg_dump neumí přečíst novější databázi a záloha skončí chybou.',
        action: `Doplňte do image postgresql${REQUIRED_MAJOR}-client.`,
      });
    }
  }
  return findings;
};

const checkStorage: DoctorCheck = async (ctx) => {
  // `workspaces` má RLS (politika ws_isolation_self přes id), takže pod
  // aplikační rolí bez kontextu vrátí nula a diagnostika by usoudila, že je
  // instalace prázdná. Prázdná instalace přitom potlačuje nález o chybějící
  // záloze, takže by tichá chyba schovala hlasitou.
  if (ctx.adminUrl === null) {
    return [cannotRun('stav úložiště', 'Chybí DATABASE_URL_MIGRATOR.')];
  }
  const hasData = await withAdminTx(ctx.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE deleted_at IS NULL`,
    );
    return rows[0]!.n > 0;
  });
  const findings = await Promise.all([
    checkDataVolume(ctx.dataDir, hasData),
    checkBackupFreshness(ctx.backupDir, ctx.now, hasData),
  ]);
  return findings.filter((f): f is DoctorFinding => f !== null);
};

export const storageChecks: readonly DoctorCheck[] = [checkBinaries, checkStorage];
