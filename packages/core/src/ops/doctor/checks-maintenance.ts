import { sql } from 'drizzle-orm';
import { OPS_AUDIT_ACTIONS } from '../audit';
import { withAdminTx } from '../db';
import { cannotRun, type DoctorCheck, type DoctorFinding } from './types';

/**
 * HLÍDÁNÍ, ŽE ÚKLID ODDÍLŮ OPRAVDU BĚŽÍ.
 *
 * Bez tohohle nálezu je auditní záznam o údržbě jen řádek v tabulce, do které
 * se nikdo nedívá. Aplikace při vynechaném úklidu běží dál, jen
 * `messages.render_data`, tedy personalizační data příjemce, zůstávají
 * v databázi přes lhůtu danou `MESSAGE_RETENTION_DAYS`, a po čtyřech měsících
 * bez zakládání oddílů dopředu přestane instalace přijímat zápisy. Je to ten
 * druh poruchy, kterou nikdo neohlásí, protože se nic nerozbije.
 *
 * OD 7. 8. 2026 SE TO HLÁSÍ JINÉMU ČTENÁŘI. Do té doby úklid uměl jedině
 * `mlain partitions` z plánovače hostitele, takže nález skoro vždycky znamenal
 * „nikdo si ten plánovač nezavedl" a v dodávané instalaci se ho nedalo zbavit
 * vůbec. Práci teď dělá cronová fronta `platform.maintain_partitions` ve
 * workeru, takže nález znamená něco jiného a užitečnějšího: buď worker neběží,
 * nebo mu chybí `DATABASE_URL_MIGRATOR`, nebo úloha padá.
 *
 * PROČ DVA DNY. Úklid má běžet denně. Jeden vynechaný den je běžná věc
 * (restart stroje, delší upgrade, nasazení přes noc) a nálezem by z něj
 * bylo varování, které chodí planě, tedy varování, které se přestane číst.
 * Dva dny už znamenají, že se to nespravilo samo.
 */
export const PARTITION_MAINTENANCE_STALE_SECONDS = 2 * 24 * 60 * 60;

/**
 * Rozhodnutí oddělené od dotazu, aby šlo otestovat bez databáze i na hraně
 * (den a půl mlčí, dva dny a chvilka hlásí).
 */
export function partitionMaintenanceFindings(lastRunAt: Date | null, now: Date): DoctorFinding[] {
  if (lastRunAt === null) {
    return [
      {
        id: 'no_partition_maintenance_yet',
        severity: 'warning',
        title: 'Údržba oddílů v téhle instalaci ještě nikdy neproběhla',
        detail:
          'V auditu není jediný záznam akce partition.maintained. Úklid odeslané pošty dělá ' +
          'noční úloha workeru platform.maintain_partitions; dokud neproběhne, drží instalace ' +
          'messages.render_data navěky a po čtyřech měsících přestane přijímat zápisy, ' +
          'protože se nezaloží další oddíl.',
        action:
          'Ověřte, že běží worker (MODE=worker nebo MODE=all) a že má nastavenou proměnnou ' +
          'DATABASE_URL_MIGRATOR; bez ní úloha padá, protože aplikační role schéma nevlastní. ' +
          'Hned teď se dá úklid pustit ručně příkazem mlain partitions. Postup je ' +
          'v docs/operations/partitions-retention.md.',
      },
    ];
  }

  const ageSeconds = Math.floor((now.getTime() - lastRunAt.getTime()) / 1000);
  if (ageSeconds < PARTITION_MAINTENANCE_STALE_SECONDS) return [];
  const ageDays = Math.floor(ageSeconds / 86_400);
  return [
    {
      id: 'partition_maintenance_stale',
      severity: 'warning',
      title: `Údržba oddílů naposledy proběhla před ${ageDays} dny`,
      detail:
        `Poslední záznam akce partition.maintained je z ${lastRunAt.toISOString()}, přestože ` +
        'má úklid běžet denně. Odeslaná pošta i webové události tedy leží v databázi přes ' +
        'lhůtu a nezakládají se oddíly dopředu.',
      action:
        'Podívejte se do logu workeru, proč noční úloha platform.maintain_partitions selhala. ' +
        'Když úklid pouštíte vlastním plánovačem hostitele, zkontrolujte jeho výpis.',
    },
  ];
}

/**
 * HLÍDÁNÍ, ŽE OVĚŘENÍ ZÁLOHY OPRAVDU BĚŽÍ.
 *
 * PROČ TO NEUMÍ HLÍDAČ TICHA VE WORKERU. `apps/worker/src/cron-watch.ts` pozná
 * frontu, do které se přestalo tikat, jenže jenom potud, pokud je to vidět
 * v tabulce úloh. pg-boss maže dokončené úlohy po sedmi dnech
 * (`deletion_seconds`), a `platform.backup_verify` tiká TÝDNĚ. Delší ticho než
 * týden se z tabulky úloh doložit nedá, takže si ho hlídač schválně netvrdí:
 * chybějící řádek tam znamená „ještě nikdy" i „už dávno" a rozlišit to neumí.
 * Je to napsané i v hlavičce toho souboru jako přiznané slepé místo.
 *
 * PROČ TO UMÍ DOKTOR. Audit tenhle problém nemá: `backup.verified` se zapisuje
 * do `audit_log` a ten drží záznamy měsíce (`AUDIT_RETENTION_MONTHS`), ne sedm
 * dní. Ověření zálohy tedy hlídá týž mechanismus jako údržbu oddílů, jen
 * s jinou lhůtou.
 *
 * PROČ ČTRNÁCT DNÍ. Táž úvaha jako u oddílů, tedy DVĚ periody: úloha tiká
 * v neděli ve 4:00, jedna vynechaná neděle (restart, delší upgrade, nasazení)
 * je běžná věc a plané varování se přestane číst. Dvě vynechané neděle už
 * znamenají, že se to nespravilo samo.
 *
 * PROČ SE ČERSTVÁ INSTALACE NEHLÁSÍ. Instalace nasazená v pondělí se poprvé
 * ověřuje až v neděli, takže „ještě nikdy" je šest dní úplně v pořádku. Nález
 * se proto opírá o PRVNÍ zálohu: dokud instalace nezálohuje déle, než je
 * tolerance, není co ověřovat a mlčí se. A když nezálohuje vůbec, patří to
 * nálezu `no_backup_yet` v kontrole úložiště, ne sem; jeden problém má mít
 * jednu větu.
 */
export const BACKUP_VERIFY_STALE_SECONDS = 14 * 24 * 60 * 60;

export type BackupVerifyState = {
  lastVerifiedAt: Date | null;
  /**
   * Dopadlo poslední ověření dobře? `null` znamená, že to z metadat nešlo
   * přečíst (starý záznam, ručně vložený řádek).
   *
   * PROČ TO NESTAČÍ HLÍDAT STÁŘÍM. `backupVerifyJob` zapíše auditní záznam
   * i tehdy, když ověření NEPROŠLO: `{ ok: false, problems: [...] }`. Instalace,
   * které se ověření každou neděli nepovede, tedy má záznam čerstvý a podle
   * stáří by vypadala v pořádku. Bylo by to nejhorší možné hlášení: klid
   * odvozený z toho, že porucha pravidelně nastává.
   */
  lastVerifiedOk: boolean | null;
  firstBackupAt: Date | null;
};

export function backupVerifyFindings(state: BackupVerifyState, now: Date): DoctorFinding[] {
  const { lastVerifiedAt, lastVerifiedOk, firstBackupAt } = state;
  const ageSeconds = (from: Date): number => Math.floor((now.getTime() - from.getTime()) / 1000);

  if (lastVerifiedAt === null) {
    // Bez jediné zálohy není co ověřovat a mluví za to `no_backup_yet`.
    if (firstBackupAt === null) return [];
    if (ageSeconds(firstBackupAt) < BACKUP_VERIFY_STALE_SECONDS) return [];
    return [
      {
        id: 'no_backup_verify_yet',
        severity: 'warning',
        title: 'Zálohy se v téhle instalaci nikdy neověřily',
        detail:
          `Instalace zálohuje od ${firstBackupAt.toISOString()}, ale v auditu není jediný ` +
          'záznam akce backup.verified. Týdenní úloha workeru platform.backup_verify tedy ' +
          'neproběhla ani jednou a nikdo neví, jestli se z těch záloh dá obnovit. Neověřená ' +
          'záloha je horší než žádná: vypadá jako pojistka a chová se jako sázka.',
        action:
          'Ověřte, že běží worker a že má nastavenou proměnnou DATABASE_URL_MIGRATOR; bez ní ' +
          'úloha padá. Ručně to udělá mlain backup verify nad posledním adresářem v BACKUP_DIR.',
      },
    ];
  }

  // Neúspěšné ověření se hlásí BEZ OHLEDU NA STÁŘÍ, a jde před nález o ticho:
  // instalace, kde ověření pravidelně padá, má záznam čerstvý, takže by ji
  // hlídání stáří prohlásilo za v pořádku.
  if (lastVerifiedOk === false) {
    return [
      {
        id: 'backup_verify_failed',
        severity: 'warning',
        title: 'Poslední ověření zálohy NEPROŠLO',
        detail:
          `Záznam akce backup.verified z ${lastVerifiedAt.toISOString()} nese ok=false. ` +
          'Ověření obnovuje dump do dočasné databáze a porovnává počty řádků proti manifestu, ' +
          'takže tohle znamená, že se z poslední zálohy nepodařilo obnovit. Důvody jsou ' +
          'v metadatech toho záznamu pod klíčem problems.',
        action:
          'Pusťte mlain backup verify nad posledním adresářem v BACKUP_DIR a přečtěte si ' +
          'výpis. Dokud tohle platí, počítejte s tím, že instalace zálohu prakticky nemá.',
      },
    ];
  }

  const age = ageSeconds(lastVerifiedAt);
  if (age < BACKUP_VERIFY_STALE_SECONDS) return [];
  const ageDays = Math.floor(age / 86_400);
  return [
    {
      id: 'backup_verify_stale',
      severity: 'warning',
      title: `Záloha se naposledy ověřovala před ${ageDays} dny`,
      detail:
        `Poslední záznam akce backup.verified je z ${lastVerifiedAt.toISOString()}, přestože ` +
        'se má ověřovat každý týden. Od té doby se o žádné pořízené záloze neví, jestli je ' +
        'obnovitelná.',
      action:
        'Podívejte se do logu workeru, proč týdenní úloha platform.backup_verify selhala, ' +
        'a mezitím ověřte poslední zálohu ručně příkazem mlain backup verify.',
    },
  ];
}

const checkBackupVerify: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) {
    return [cannotRun('ověřování záloh', 'Chybí DATABASE_URL_MIGRATOR.')];
  }
  const state = await withAdminTx(ctx.adminUrl, async (tx) => {
    // Dva dotazy, protože jsou to dvě různé otázky: „odkdy tahle instalace
    // zálohuje" je agregace přes všechny zálohy, kdežto výsledek ověření patří
    // k JEDNOMU konkrétnímu, nejnovějšímu řádku. Agregace `max(created_at)`
    // a `metadata` z téhož řádku se v jednom `GROUP BY` neposkládají, aniž by
    // se ten řádek stejně dohledával podruhé.
    const verified = await tx.execute<{
      created_at: string | Date;
      ok: boolean | null;
    }>(sql`
      SELECT created_at, (metadata->>'ok')::boolean AS ok
        FROM audit_log
       WHERE workspace_id IS NULL
         AND action = ${String(OPS_AUDIT_ACTIONS['backup.verified'])}
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const first = await tx.execute<{ created_at: string | Date | null }>(sql`
      SELECT min(created_at) AS created_at
        FROM audit_log
       WHERE workspace_id IS NULL
         AND action = ${String(OPS_AUDIT_ACTIONS['backup.created'])}
    `);
    const last = verified.rows[0];
    return {
      lastVerifiedAt: last === undefined ? null : new Date(last.created_at),
      lastVerifiedOk: last?.ok ?? null,
      firstBackupAt:
        first.rows[0]?.created_at == null ? null : new Date(first.rows[0].created_at as string),
    };
  });
  return backupVerifyFindings(state, ctx.now);
};

const checkPartitionMaintenance: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) {
    return [cannotRun('údržba oddílů', 'Chybí DATABASE_URL_MIGRATOR.')];
  }
  const lastRunAt = await withAdminTx(ctx.adminUrl, async (tx) => {
    // Krycí index `idx_audit_log__ws_created` je nad (workspace_id, created_at DESC)
    // a podmínka na NULL projekt ho použije; záznam je globální, takže se tím
    // rovnou vyloučí i všechen projektový audit.
    const { rows } = await tx.execute<{ created_at: string | Date }>(sql`
      SELECT created_at
        FROM audit_log
       WHERE workspace_id IS NULL
         AND action = ${String(OPS_AUDIT_ACTIONS['partition.maintained'])}
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const value = rows[0]?.created_at;
    return value === undefined ? null : new Date(value);
  });
  return partitionMaintenanceFindings(lastRunAt, ctx.now);
};

export const maintenanceChecks: readonly DoctorCheck[] = [
  checkPartitionMaintenance,
  checkBackupVerify,
];
