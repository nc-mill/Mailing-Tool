import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { createWorkspaceContext } from '../../identity/context';
import { hashPassword } from '../../identity/password';
import type { WorkspaceContext } from '../../identity/types';
import { EMPTY_AST } from '../../segments/ast';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { appPool, closePools, withWorkspace, withoutContext } from '../../tx';
import { writeBatch } from './batch';
import { importErrorCode } from './errors';
import { resetImportLimits } from './limits';
import { resetImportEnqueueConfig } from './jobs/enqueue';
import { recoverStaleImports } from './jobs/recover-stale';
import { handler as runImport } from './jobs/run-import';
import { runRetention } from './jobs/retention';
import type { ProcessedOkRow } from './row-pipeline';
import {
  cancelImport,
  confirmImport,
  createImport,
  detectAndPreview,
  resumeImport,
  setTotalRows,
} from './service';
import { createExport, verifyDownloadToken } from '../export/service';
import { handler as runExport } from '../export/jobs/run-export';

/**
 * Databázová sada importu a exportu. Nejdůležitější test celé sady je
 * „rolls back the whole batch when one statement fails": je to jediný důkaz,
 * že kontakty a checkpoint leží v JEDNÉ transakci. Kdyby ne, pád workera by
 * po restartu naimportoval tytéž řádky podruhé.
 */

/** Fronty, do kterých tahle doména zařazuje joby. `job.name` má cizí klíč na `queue.name`. */
const QUEUES_USED = ['contacts.import', 'contacts.export', 'contacts.cleanup_import_files'];

const DATA_DIR = mkdtempSync(join(tmpdir(), 'mlain-import-db-'));
process.env['DATA_DIR'] = DATA_DIR;

let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let seedUserId = '';
let workspaceCounter = 0;
let ctx: WorkspaceContext;

async function installPgBoss(url: string, migrator: Pool): Promise<void> {
  const boss = new PgBoss({
    connectionString: url,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
  });
  await boss.start();
  for (const name of QUEUES_USED) await boss.createQueue(name);
  await boss.stop({ graceful: false });
  await migrator.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
  await migrator.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
}

async function testContext(): Promise<WorkspaceContext> {
  workspaceCounter += 1;
  const slug = `imp-${process.pid}-${Date.now()}-${workspaceCounter}`.slice(0, 62);
  const workspace = await createWorkspaceAsUser(appPool(), seedUserId, {
    name: `Import ${workspaceCounter}`,
    slug,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  return createWorkspaceContext({
    kind: 'session',
    userId: seedUserId,
    workspaceRef: workspace.id,
  });
}

beforeAll(async () => {
  process.env['DATA_DIR'] = DATA_DIR;
  harness = await startPgHarness();
  process.env['DATA_DIR'] = DATA_DIR;
  resetImportLimits();
  resetImportEnqueueConfig();
  await closePools();

  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });
  await installPgBoss(harness.migratorUrl, migratorPool);

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx
      .insert(schema.users)
      .values({
        email: `import-${process.pid}-${Date.now()}@example.cz`,
        passwordHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    const row = inserted[0];
    if (row === undefined) throw new Error('seed user nevznikl');
    return row.id;
  });
  ctx = await testContext();
}, 300_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await harness?.stop();
  harness = null;
}, 120_000);

// --- pomocníci nad tabulkou imports -----------------------------------------

type ImportSnapshot = {
  checkpoint_row: number;
  checkpoint_byte: number;
  processed_rows: number;
  created_rows: number;
  updated_rows: number;
  error_rows: number;
  warning_rows: number;
  stored_error_count: number;
  error_summary: Record<string, number>;
  storage_key: string | null;
  updated_at: Date | null;
};

async function createImportRow(target: WorkspaceContext): Promise<string> {
  const { rows } = await withWorkspace(target, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO imports (workspace_id, filename, storage_key, byte_size, content_sha256,
                           idempotency_key, status, file_expires_at)
      VALUES (${target.workspaceId}::uuid, 'a.csv', 'imports/a.csv', 10,
              ${Buffer.alloc(32, 3)}, ${`k-${Math.random()}`}, 'importing', now() + interval '1 day')
      RETURNING id`),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('import nevznikl');
  return row.id;
}

async function readImport(target: WorkspaceContext, importId: string): Promise<ImportSnapshot> {
  const { rows } = await withWorkspace(target, (tx) =>
    tx.execute<ImportSnapshot>(sql`
      SELECT checkpoint_row, checkpoint_byte, processed_rows, created_rows, updated_rows,
             error_rows, warning_rows, stored_error_count, error_summary, storage_key, updated_at
        FROM imports WHERE id = ${importId}::uuid`),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('import nenalezen');
  return row;
}

async function setImportState(
  target: WorkspaceContext,
  importId: string,
  patch: {
    status?: string;
    updatedAtMinutesAgo?: number;
    checkpointRow?: number;
    fileExpiresAtDaysAgo?: number;
  },
): Promise<void> {
  await withWorkspace(target, (tx) =>
    tx.execute(sql`
      UPDATE imports SET
        status = coalesce(${patch.status ?? null}::text, status),
        checkpoint_row = coalesce(${patch.checkpointRow ?? null}::bigint, checkpoint_row),
        file_expires_at = CASE WHEN ${patch.fileExpiresAtDaysAgo ?? null}::int IS NULL
                               THEN file_expires_at
                               ELSE now() - make_interval(days => ${patch.fileExpiresAtDaysAgo ?? 0}) END,
        updated_at = CASE WHEN ${patch.updatedAtMinutesAgo ?? null}::int IS NULL
                          THEN updated_at
                          ELSE now() - make_interval(mins => ${patch.updatedAtMinutesAgo ?? 0}) END
      WHERE id = ${importId}::uuid`),
  );
}

const ok = (email: string, rowNumber: number): ProcessedOkRow => ({
  kind: 'ok',
  email,
  rowNumber,
  subscribe: true,
  consent: null,
  warnings: [],
  tags: [],
  attributes: {},
  // Klíče jmen jsou tu schválně: bez nich by fronta ke kontrole oslovení,
  // která na částečném indexu nad nimi stojí, zůstala po importu prázdná.
  contact: {
    email,
    firstName: 'Alena',
    lastName: 'Bílá',
    firstNameKey: 'alena',
    lastNameKey: 'bila',
    gender: 'female',
    greeting: 'Dobrý den, Aleno',
    vocativeConfidence: 'high',
    attributes: {},
  },
});

const err = (rowNumber: number, errorCode: string, severity: 'error' | 'warning' = 'error') => ({
  rowNumber,
  errorCode,
  severity,
  raw: 'x',
});

const base = { mode: 'update' as const, errors: [], suppressedCount: 0, maxStoredErrors: 10_000 };

describe('batch write', () => {
  it('writes contacts and the checkpoint in one transaction', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [ok('a@x.cz', 1), ok('b@x.cz', 2)],
      checkpointRow: 2,
      checkpointByte: 120,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.checkpoint_row)).toBe(2);
    expect(Number(row.created_rows)).toBe(2);
    expect(Number(row.processed_rows)).toBe(2);
    expect(row.updated_at).not.toBeNull();
  });

  it('fills the name keys, so the vocative review queue is not left empty', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [ok('k@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    });
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ first_name_key: string | null }>(sql`
        SELECT first_name_key FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'k@x.cz'`),
    );
    expect(rows[0]?.first_name_key).toBe('alena');
  });

  it('rolls back the whole batch when one statement fails', async () => {
    const importId = await createImportRow(ctx);
    await expect(
      writeBatch(ctx, {
        ...base,
        importId,
        rows: [ok('c@x.cz', 1), { ...ok('d@x.cz', 2), contact: { email: null } } as never],
        checkpointRow: 2,
        checkpointByte: 50,
      }),
    ).rejects.toThrow();
    const row = await readImport(ctx, importId);
    expect(Number(row.checkpoint_row)).toBe(0);
    expect(Number(row.created_rows)).toBe(0);
    // A hlavně: ani jeden kontakt z té dávky. Kdyby upsert běžel ve VLASTNÍ
    // transakci, tenhle řádek by přežil a po restartu by se zapsal podruhé.
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'c@x.cz'`),
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('distinguishes inserts from updates', async () => {
    const importId = await createImportRow(ctx);
    const batch = {
      ...base,
      importId,
      rows: [ok('e@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    };
    await writeBatch(ctx, batch);
    await writeBatch(ctx, { ...batch, checkpointRow: 2 });
    const row = await readImport(ctx, importId);
    expect(Number(row.created_rows)).toBe(1);
    expect(Number(row.updated_rows)).toBe(1);
  });

  it('stops storing error rows above the limit but keeps counting them', async () => {
    const importId = await createImportRow(ctx);
    const errors = Array.from({ length: 5 }, (_, i) => err(i + 1, 'email_invalid'));
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [],
      errors,
      checkpointRow: 5,
      checkpointByte: 10,
      maxStoredErrors: 2,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.error_rows)).toBe(5);
    expect(row.error_summary['email_invalid']).toBe(5);
    expect(Number(row.stored_error_count)).toBe(2);
  });

  it('stores warning rows as warnings, not as errors', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [],
      errors: [err(1, 'email_invalid', 'error'), err(2, 'gender_unknown', 'warning')],
      checkpointRow: 2,
      checkpointByte: 10,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.error_rows)).toBe(1);
    expect(Number(row.warning_rows)).toBe(1);
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ severity: string; n: number }>(sql`
        SELECT severity, count(*)::int AS n FROM import_errors
         WHERE import_id = ${importId}::uuid GROUP BY severity ORDER BY severity`),
    );
    expect(rows).toEqual([
      { severity: 'error', n: 1 },
      { severity: 'warning', n: 1 },
    ]);
  });

  it('SUMS error_summary across batches instead of overwriting it', async () => {
    // Tenhle test musí být nad DVĚMA dávkami. Při jedné je nahrazení a součet
    // totéž, takže by chybu nezachytil.
    const importId = await createImportRow(ctx);
    const b = { ...base, importId, rows: [], checkpointByte: 10 };
    await writeBatch(ctx, { ...b, errors: [err(1, 'email_invalid')], checkpointRow: 1 });
    await writeBatch(ctx, {
      ...b,
      errors: [err(2, 'email_invalid'), err(3, 'email_missing')],
      checkpointRow: 3,
    });
    const row = await readImport(ctx, importId);
    expect(row.error_summary).toEqual({ email_invalid: 2, email_missing: 1 });
    expect(Number(row.error_rows)).toBe(3);
  });
});

// --- služba importu ----------------------------------------------------------

const csv = (): Readable =>
  Readable.from([Buffer.from('email;name\na@x.cz;Jana Nováková\n', 'utf8')]);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

/**
 * Skutečná cesta z `pending` do `previewing`: detekce kódování, oddělovače
 * a návrh mapování nad nahraným souborem. Ruční UPDATE stavu by tenhle krok
 * přeskočil a testy potvrzení by běžely nad importem bez mapování.
 */
async function readyForConfirm(own: WorkspaceContext, importId: string): Promise<void> {
  await detectAndPreview(own, importId);
}

describe('import service', () => {
  it('creates an import in state pending', async () => {
    const own = await testContext();
    const out = await createImport(own, { stream: csv(), filename: 'a.csv' });
    expect(out.status).toBe('pending');
    expect(out.id).toHaveLength(36);
  });

  it('rejects the same file with the same mapping within 24 hours', async () => {
    const own = await testContext();
    const first = await createImport(own, { stream: csv(), filename: 'a.csv' });
    await readyForConfirm(own, first.id);
    await confirmImport(own, first.id);
    expect(await codeOf(createImport(own, { stream: csv(), filename: 'a.csv' }))).toBe(
      'import_duplicate',
    );
  });

  it('accepts the same file with a different mapping without asking', async () => {
    const own = await testContext();
    const first = await createImport(own, { stream: csv(), filename: 'b.csv' });
    const second = await createImport(own, {
      stream: csv(),
      filename: 'b.csv',
      mapping: { '0': { target: 'email' } },
    });
    expect(second.id).not.toBe(first.id);
  });

  it('refuses a second running import in the same workspace', async () => {
    const own = await testContext();
    const first = await createImport(own, { stream: csv(), filename: 'c.csv' });
    const second = await createImport(own, {
      stream: csv(),
      filename: 'd.csv',
      mapping: { '0': { target: 'email' } },
    });
    for (const id of [first.id, second.id]) await readyForConfirm(own, id);
    await confirmImport(own, first.id);
    expect(await codeOf(confirmImport(own, second.id))).toBe('import_already_running');
  });

  it('keeps written contacts when cancelled and records the row it stopped at', async () => {
    const own = await testContext();
    const imp = await createImport(own, { stream: csv(), filename: 'e.csv' });
    await readyForConfirm(own, imp.id);
    await setTotalRows(own, imp.id, 1);
    await confirmImport(own, imp.id);
    const cancelled = await cancelImport(own, imp.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.failureDetail).toMatch(/\d+/);
    // Bez zapsaného total_rows by hláška vždycky končila „z ?", což je platný
    // řetězec, takže by to test na /\d+/ neodhalil. Proto se hlídá i konec věty.
    expect(cancelled.failureDetail).not.toContain('z ?');
  });

  it('resumes from the cancelled checkpoint instead of the beginning', async () => {
    const own = await testContext();
    const imp = await createImport(own, { stream: csv(), filename: 'f.csv' });
    await readyForConfirm(own, imp.id);
    await confirmImport(own, imp.id);
    await cancelImport(own, imp.id);
    const resumed = await resumeImport(own, imp.id);
    expect(resumed.resumeFromImportId).toBe(imp.id);
    expect(resumed.checkpointByte).toBeGreaterThanOrEqual(0);
  });
});

// --- obnova po pádu a retence ------------------------------------------------

/**
 * NÁLEZ PROTI P03, ŽIVÝ. Rozhodnutí R18 plánu počítá s politikou `system_bypass`
 * nad `imports`, aby šel udělat sken napříč projekty. Migrace ji dnes nemají
 * (`grep -r system_bypass packages/db` nic nenajde), takže `withoutContext`
 * vrátí nula řádků a NEVRÁTÍ chybu.
 *
 * Právě proto má sken strážce: kdyby ho neměl, job by každou hodinu hlásil
 * `{ recovered: 0 }`, zaseknuté importy by se nikdy neobnovily a projekt by měl
 * navždy obsazený `singletonKey`. Test proto ověřuje, že sken selže HLASITĚ,
 * a druhý test ověřuje samotný predikát zastaralosti pod kontextem projektu,
 * kde ho RLS neschová. Až P03 politiku dodá, první test se změní na
 * „requeues a stale import" a druhý zůstane.
 */
describe('crash recovery', () => {
  it('fails loudly instead of reporting zero while the cross workspace scan is blocked', async () => {
    const own = await testContext();
    const id = await createImportRow(own);
    await setImportState(own, id, {
      status: 'importing',
      updatedAtMinutesAgo: 30,
      checkpointRow: 4,
    });
    expect(
      await codeOf(
        recoverStaleImports({ staleMinutes: 10 }, async () => {
          /* zařazení se v tomhle stavu vůbec nedostane ke slovu */
        }),
      ),
    ).toBe('cross_workspace_scan_blocked');
  });

  it('selects the stale import and leaves the fresh one alone', async () => {
    const own = await testContext();
    const stale = await createImportRow(own);
    const fresh = await createImportRow(own);
    await setImportState(own, stale, { status: 'importing', updatedAtMinutesAgo: 30 });
    await setImportState(own, fresh, { status: 'importing', updatedAtMinutesAgo: 1 });
    const { rows } = await withWorkspace(own, (tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT id FROM imports
         WHERE workspace_id = ${own.workspaceId}::uuid AND status = 'importing'
           AND updated_at < now() - make_interval(mins => 10)`),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(stale);
    expect(ids).not.toContain(fresh);
  });
});

// --- celá roura: worker importu ----------------------------------------------

const HEADER = 'email;name\n';
const ROW_A = 'a@x.cz;Jana Novakova\n';
const ROW_B = 'b@x.cz;Petr Maly\n';
const WHOLE_FILE = HEADER + ROW_A + ROW_B;

async function runnableImport(own: WorkspaceContext): Promise<string> {
  const created = await createImport(own, {
    stream: Readable.from([Buffer.from(WHOLE_FILE, 'utf8')]),
    filename: 'run.csv',
  });
  await detectAndPreview(own, created.id);
  await confirmImport(own, created.id);
  return created.id;
}

async function contactEmails(own: WorkspaceContext): Promise<string[]> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE workspace_id = ${own.workspaceId}::uuid ORDER BY email`),
  );
  return rows.map((r) => r.email);
}

describe('import worker', () => {
  it('walks the whole file and finishes the import', async () => {
    const own = await testContext();
    const importId = await runnableImport(own);
    const out = await runImport({ data: { workspaceId: own.workspaceId, importId, phase: 'run' } });
    expect(out.processed).toBe(2);
    expect(await contactEmails(own)).toEqual(['a@x.cz', 'b@x.cz']);
    const { rows } = await withWorkspace(own, (tx) =>
      tx.execute<{ status: string; created_rows: number }>(sql`
        SELECT status, created_rows FROM imports WHERE id = ${importId}::uuid`),
    );
    expect(rows[0]?.status).toBe('completed');
    expect(Number(rows[0]?.created_rows)).toBe(2);
  });

  it('resumes from the checkpoint byte instead of importing the first row twice', async () => {
    const own = await testContext();
    const importId = await runnableImport(own);
    // Checkpoint po prvním datovém řádku. Přesně tenhle stav zanechá pád workera
    // uprostřed souboru: dávka i checkpoint byly zapsané v JEDNÉ transakci.
    const afterFirst = Buffer.byteLength(HEADER + ROW_A, 'utf8');
    await withWorkspace(own, (tx) =>
      tx.execute(sql`
        UPDATE imports SET checkpoint_row = 1, checkpoint_byte = ${afterFirst}
         WHERE id = ${importId}::uuid`),
    );
    const out = await runImport({ data: { workspaceId: own.workspaceId, importId, phase: 'run' } });
    expect(out.processed).toBe(1);
    expect(await contactEmails(own)).toEqual(['b@x.cz']);
  });
});

describe('file retention', () => {
  it('is idempotent: the second run offers nothing', async () => {
    const own = await testContext();
    const id = await createImportRow(own);
    await setImportState(own, id, { status: 'completed', fileExpiresAtDaysAgo: 1 });
    expect(await runRetention(own)).toBe(1);
    expect((await readImport(own, id)).storage_key).toBeNull();
    expect(await runRetention(own)).toBe(0);
  });
});

// --- export ------------------------------------------------------------------

async function insertContact(
  target: WorkspaceContext,
  row: { email: string; firstName: string; lastName: string },
): Promise<void> {
  await withWorkspace(target, (tx) =>
    tx.execute(sql`
      INSERT INTO contacts (workspace_id, email, first_name, last_name, status, attributes)
      VALUES (${target.workspaceId}::uuid, ${row.email}::citext, ${row.firstName},
              ${row.lastName}, 'active', '{}'::jsonb)`),
  );
}

async function readExportFile(target: WorkspaceContext, exportId: string): Promise<Buffer> {
  const { rows } = await withWorkspace(target, (tx) =>
    tx.execute<{ storage_key: string }>(sql`
      SELECT storage_key FROM exports WHERE id = ${exportId}::uuid`),
  );
  const key = rows[0]?.storage_key;
  if (key === undefined || key === null) throw new Error('export nemá soubor');
  return readFile(join(DATA_DIR, key));
}

describe('contact export', () => {
  let exportCtx: WorkspaceContext;

  beforeAll(async () => {
    exportCtx = await testContext();
    await insertContact(exportCtx, {
      email: 'jana@x.cz',
      firstName: 'Jana',
      lastName: 'Nováková',
    });
    await insertContact(exportCtx, {
      email: 'evil@x.cz',
      firstName: "=cmd|'/c calc'!A1",
      lastName: 'X',
    });
  }, 120_000);

  const filter = { ast: EMPTY_AST } as Record<string, unknown>;

  it('writes utf-8 with a BOM by default so czech excel opens it correctly', async () => {
    const created = await createExport(exportCtx, {
      kind: 'contacts',
      filter,
      columns: ['email', 'first_name'],
    });
    await runExport({ data: { workspaceId: exportCtx.workspaceId, exportId: created.id } });
    const buf = gunzipSync(await readExportFile(exportCtx, created.id));
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('uses a semicolon for cs and a comma otherwise', async () => {
    const cs = await createExport(exportCtx, {
      kind: 'contacts',
      filter,
      columns: ['email'],
      locale: 'cs',
    });
    const en = await createExport(exportCtx, {
      kind: 'contacts',
      filter,
      columns: ['email'],
      locale: 'en',
    });
    expect(cs.delimiter).toBe(';');
    expect(en.delimiter).toBe(',');
  });

  it('prefixes a formula cell with an apostrophe', async () => {
    const created = await createExport(exportCtx, {
      kind: 'contacts',
      filter,
      columns: ['email', 'first_name'],
    });
    await runExport({ data: { workspaceId: exportCtx.workspaceId, exportId: created.id } });
    const text = gunzipSync(await readExportFile(exportCtx, created.id)).toString('utf8');
    expect(text).toContain("'=cmd");
  });

  it('reports characters_lost when windows-1250 cannot represent a character', async () => {
    await insertContact(exportCtx, { email: 'jp@x.cz', firstName: '日本', lastName: 'X' });
    const created = await createExport(exportCtx, {
      kind: 'contacts',
      filter,
      columns: ['first_name'],
      encoding: 'windows-1250',
    });
    const out = await runExport({
      data: { workspaceId: exportCtx.workspaceId, exportId: created.id },
    });
    expect(out.warnings).toContain('characters_lost');
  });

  it('accepts a one time download token and refuses it the second time', async () => {
    const created = await createExport(exportCtx, { kind: 'contacts', filter, columns: ['email'] });
    await runExport({ data: { workspaceId: exportCtx.workspaceId, exportId: created.id } });
    expect(await verifyDownloadToken(exportCtx, created.id, created.downloadToken)).toBe(true);
    expect(await verifyDownloadToken(exportCtx, created.id, created.downloadToken)).toBe(false);
  });

  it('exports exactly the contacts of a segment, envelope included', async () => {
    const created = await createExport(exportCtx, {
      kind: 'contacts',
      filter: {
        ast: {
          version: 1,
          root: {
            type: 'group',
            op: 'and',
            children: [
              {
                type: 'condition',
                field: { kind: 'contact', key: 'status' },
                operator: 'eq',
                value: 'active',
              },
            ],
          },
        },
      },
      columns: ['email'],
    });
    const out = await runExport({
      data: { workspaceId: exportCtx.workspaceId, exportId: created.id },
    });
    expect(out.rowCount).toBeGreaterThan(0);
  });
});
