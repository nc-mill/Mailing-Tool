import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { writeAuditLog } from '../audit/write';
import { OPS_AUDIT_ACTIONS } from './audit';
import {
  compareRowCounts,
  fileSha256,
  isBackupFromNewerVersion,
  readManifest,
  type RowCountDiff,
} from './backup-manifest';
import { applyGrants } from './backup-verify';
import { withAdminTx } from './db';
import { runProcess } from './run-process';

export class RestoreRefusedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'RestoreRefusedError';
  }
}

export type RestoreInput = {
  backupDir: string;
  databaseUrl: string;
  uploadsDir: string;
  appVersion: string;
  currentFingerprint: string;
  force: boolean;
  skipUploads?: boolean;
  acknowledgeKeyDiffers?: boolean;
};

export type RestoreReport = {
  rowCountDiffs: RowCountDiff[];
  comparedTables: number;
  keyDiffers: boolean;
};

export async function restoreBackup(input: RestoreInput): Promise<RestoreReport> {
  // Brána 1: manifest, format_version a kontrolní součty.
  const manifest = await readManifest(input.backupDir);
  const dumpPath = join(input.backupDir, 'database.dump');
  const hash = await fileSha256(dumpPath);
  if (hash !== manifest.database.sha256) {
    throw new RestoreRefusedError(
      'Kontrolní součet database.dump nesedí, záloha je poškozená. Obnova se nespustí a databáze zůstala nedotčená.',
      'backup_checksum_mismatch',
    );
  }

  // Brána 2: verze image.
  if (isBackupFromNewerVersion(manifest.app_version, input.appVersion)) {
    throw new RestoreRefusedError(
      `backup_from_newer_version: záloha je z verze ${manifest.app_version}, tahle image je ${input.appVersion}. ` +
        'Novější zálohu do starší aplikace obnovit nejde, poškodila by schéma. Aktualizujte image a zkuste to znovu.',
      'backup_from_newer_version',
    );
  }

  // Brána 3: prázdnost cílové databáze.
  if (!(await isDatabaseEmpty(input.databaseUrl)) && !input.force) {
    throw new RestoreRefusedError(
      'Cílová databáze není prázdná a obnova by ji přepsala. Nic jsem nezměnil. ' +
        'Když to opravdu chcete, zopakujte příkaz s --force; obsah instalace se zahodí ' +
        'a záloha se nahraje do prázdné databáze.',
      'target_database_not_empty',
    );
  }

  // Brána 4: otisk klíče.
  const keyDiffers = manifest.secret_key_fingerprint !== input.currentFingerprint;
  if (keyDiffers && !input.acknowledgeKeyDiffers) {
    throw new RestoreRefusedError(
      `Otisk SECRET_KEY v záloze (${manifest.secret_key_fingerprint}) se liší od otisku aktuálního klíče ` +
        `(${input.currentFingerprint}). Uložené přístupy k odesílání ani AI klíče nepůjde přečíst a bude nutné je ` +
        'zadat znovu. Otisky smazaných adres pod starými pokoleními přestanou platit, dokud staré klíče nedoplníte ' +
        'do SECRET_KEY_PREVIOUS. Když to víte, zopakujte příkaz s --i-know-the-key-differs.',
      'secret_key_fingerprint_mismatch',
    );
  }

  // ---------------------------------------------------------------------------
  // ODCHYLKA OD PLÁNU, VYNUCENÁ CHOVÁNÍM POSTGRESU. Plán tu měl u `--force`
  // přidat `pg_restore --clean --if-exists`. Ověřeno spuštěním proti schématu
  // P03: ta dvojice **spadne**, protože devět tabulek je partitionovaných
  // a `--clean` se u každého oddílu pokusí zahodit zděděné omezení:
  //
  //   ERROR: cannot drop inherited constraint "webhook_events_y2026m11_pkey"
  //          of relation "webhook_events_y2026m11"
  //
  // Obnova by tedy s `--force` skončila nenulově uprostřed práce, tedy
  // v okamžiku, kdy je cílová databáze rozebraná. Místo toho se databáze
  // vyprázdní celá a dump se nahraje do prázdna, což je přesně to, co
  // `--force` slibuje: „přepiš, co tam je".
  // ---------------------------------------------------------------------------
  if (input.force) await emptyDatabase(input.databaseUrl);

  await runProcess('pg_restore', [
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--dbname',
    input.databaseUrl,
    dumpPath,
  ]);

  if (!input.skipUploads && manifest.uploads) {
    await mkdir(input.uploadsDir, { recursive: true });
    const archive = join(input.backupDir, 'uploads.tar.gz');
    await access(archive);
    await runProcess('tar', ['-xzf', archive, '-C', input.uploadsDir]);
  }

  // Migrační runner se načítá AŽ TADY, dynamicky. Tenhle modul se přes
  // `ops/api/*.routes.ts` a `openapi.ts` dostane do grafu modulů Next.js
  // aplikace, a runner si skládá cestu k adresáři s migracemi přes
  // `new URL('../migrations', import.meta.url)`, což bundler neumí přeložit.
  // Statický import proto shodí CELOU aplikaci na 500, ne jen tenhle příkaz.
  const { runMigrations } = await import('@mlain/db/migrate');
  await runMigrations({ url: input.databaseUrl });

  // ---------------------------------------------------------------------------
  // KROK, BEZ KTERÉHO JE OBNOVA NEPOUŽITELNÁ, a který se přehlédne nejsnáz,
  // protože všechno kolem něj vypadá hotové.
  //
  // `pg_dump --no-privileges` z úkolu 6 (tak to předepisuje 3.14) do dumpu
  // ŽÁDNÉ granty nedá. Politiky RLS v dumpu jsou, protože to jsou objekty
  // schématu, ale oprávnění ne. Spolu s daty se obnoví i ledger migrací
  // `drizzle.__drizzle_migrations`, takže `runMigrations` o řádek výš považuje
  // migraci 0005 za aplikovanou a PŘESKOČÍ JI.
  //
  // Výsledek bez tohohle řádku, ověřeno spuštěním: obnova skončí nulou,
  // migrace ohlásí, že není co dělat, a první dotaz aplikace spadne na
  // `ERROR: permission denied for table contacts`. V nejhorší možný okamžik,
  // protože obnova ze zálohy se dělá po havárii.
  //
  // Proto P03 granty vede jako idempotentní funkci `mlain_apply_grants()`
  // (rozhodnutí R25), ne jako jednorázovou migraci. Funkce v dumpu přežije
  // a zavolat se smí kolikrát chce.
  // ---------------------------------------------------------------------------
  await applyGrants(input.databaseUrl);

  const report = await withAdminTx(input.databaseUrl, async (tx) => {
    const actual: Record<string, number> = {};
    for (const table of Object.keys(manifest.row_counts)) {
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${table}"`)}`,
      );
      actual[table] = Number(rows[0]!.count);
    }
    const diffs = compareRowCounts(manifest.row_counts, actual);

    await writeAuditLog(tx, {
      action: OPS_AUDIT_ACTIONS['backup.restored'],
      workspaceId: null,
      actor: { actorType: 'system', actorId: null, actorLabel: 'mlain restore' },
      targetType: 'backup',
      targetId: manifest.installation_id,
      metadata: {
        backup_created_at: manifest.created_at,
        backup_app_version: manifest.app_version,
        force: input.force,
        key_differs: keyDiffers,
        row_count_diffs: diffs.length,
      },
    });

    return {
      rowCountDiffs: diffs,
      comparedTables: Object.keys(manifest.row_counts).length,
      keyDiffers,
    };
  });

  return report;
}

/**
 * Zahodí obsah instalace, aby šel dump nahrát do prázdna.
 *
 * `drizzle` a `pgboss` zakládá dump, respektive `docker/initdb`, takže se
 * zahazují celé. `public` se zahodí a hned založí zpět: pg_dump ho **nezakládá**
 * (ověřeno na skutečném dumpu, `CREATE SCHEMA` je v něm jen u `drizzle`),
 * takže by po `DROP SCHEMA public CASCADE` neměla obnova kam.
 */
async function emptyDatabase(databaseUrl: string): Promise<void> {
  await withAdminTx(databaseUrl, async (tx) => {
    await tx.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await tx.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
    await tx.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await tx.execute(sql`CREATE SCHEMA public`);
  });
}

/** Prázdná znamená: ve schématech public, drizzle a pgboss není jediná tabulka. */
export async function isDatabaseEmpty(databaseUrl: string): Promise<boolean> {
  return withAdminTx(databaseUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_tables
           WHERE schemaname IN ('public','drizzle','pgboss')`,
    );
    return rows[0]!.n === 0;
  });
}
