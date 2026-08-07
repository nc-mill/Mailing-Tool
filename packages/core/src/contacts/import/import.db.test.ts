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
import { addSuppression } from '../repo/suppressions';
import { ImportOptionsSchema, type ImportOptions } from './options';
import type { ProcessedOkRow } from './row-pipeline';
import {
  cancelImport,
  confirmImport,
  createImport,
  detectAndPreview,
  patchImport,
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
  /** Řádky na blokovaných adresách. Do průběhu se počítají, mezi zapsané ne. */
  suppressed_rows: number;
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
      SELECT checkpoint_row, checkpoint_byte, processed_rows, suppressed_rows,
             created_rows, updated_rows,
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
  consentOccurredAt: null,
  warnings: [],
  tags: [],
  listIds: [],
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

/*
 * `inputRows: 0` je ZÁMĚRNÁ výchozí hodnota pro volání, která ověřují ZÁPIS kontaktů,
 * ne počítadlo průběhu. Kdo měří `processed_rows`, musí si ho přepsat skutečným počtem
 * přečtených řádků; nula tam pak spadne hned, což je lepší než ticho.
 */
const base = {
  mode: 'update' as const,
  errors: [],
  suppressedCount: 0,
  maxStoredErrors: 10_000,
  inputRows: 0,
};

// --- pomocníci k volbám importu ----------------------------------------------

async function createList(
  own: WorkspaceContext,
  optIn: 'single' | 'double',
  name = `Seznam ${Math.random()}`,
): Promise<string> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO lists (workspace_id, name, opt_in)
      VALUES (${own.workspaceId}::uuid, ${name}, ${optIn}) RETURNING id`),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('seznam nevznikl');
  return row.id;
}

async function createTagRow(own: WorkspaceContext, name: string): Promise<string> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO tags (workspace_id, name)
      VALUES (${own.workspaceId}::uuid, ${name}) RETURNING id`),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('štítek nevznikl');
  return row.id;
}

async function subscriptionsOf(
  own: WorkspaceContext,
  email: string,
): Promise<{ list_id: string; status: string; source: string; confirmed_at: Date | null }[]> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ list_id: string; status: string; source: string; confirmed_at: Date | null }>(sql`
      SELECT s.list_id, s.status, s.source, s.confirmed_at
        FROM list_subscriptions s JOIN contacts c ON c.id = s.contact_id
       WHERE s.workspace_id = ${own.workspaceId}::uuid AND c.email = ${email}::citext`),
  );
  return rows;
}

async function tagNamesOf(own: WorkspaceContext, email: string): Promise<string[]> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ name: string }>(sql`
      SELECT t.name FROM contact_tags ct
        JOIN tags t ON t.id = ct.tag_id
        JOIN contacts c ON c.id = ct.contact_id
       WHERE ct.workspace_id = ${own.workspaceId}::uuid AND c.email = ${email}::citext
       ORDER BY t.name`),
  );
  return rows.map((row) => row.name);
}

async function consentsOf(
  own: WorkspaceContext,
  email: string,
): Promise<
  {
    purpose: string;
    status: string;
    legal_basis: string;
    source: string;
    source_ref: string | null;
    evidence: Record<string, unknown>;
  }[]
> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{
      purpose: string;
      status: string;
      legal_basis: string;
      source: string;
      source_ref: string | null;
      evidence: Record<string, unknown>;
    }>(sql`
      SELECT k.purpose, k.status, k.legal_basis, k.source, k.source_ref, k.evidence
        FROM consents k JOIN contacts c ON c.id = k.contact_id
       WHERE k.workspace_id = ${own.workspaceId}::uuid AND c.email = ${email}::citext`),
  );
  return rows;
}

async function consentStateOf(
  own: WorkspaceContext,
  email: string,
): Promise<{ status: string; legal_basis: string } | null> {
  const { rows } = await withWorkspace(own, (tx) =>
    tx.execute<{ status: string; legal_basis: string }>(sql`
      SELECT s.status, s.legal_basis
        FROM contact_consent_state s JOIN contacts c ON c.id = s.contact_id
       WHERE s.workspace_id = ${own.workspaceId}::uuid AND c.email = ${email}::citext`),
  );
  return rows[0] ?? null;
}

const withConsent = {
  purpose: 'email_marketing' as const,
  legal_basis: 'consent' as const,
  source: 'veletrh Brno 2026',
  declaration: true,
};

/**
 * Volby importu se STEJNOU cestou, jakou je ukládá API: přes `ImportOptionsSchema`.
 * Ručně poskládaný objekt by mohl obsahovat tvar, který by se přes PATCH nikdy
 * neuložil, a test by pak potvrzoval něco, co v provozu nenastane.
 */
function options(patch: Record<string, unknown>): ImportOptions {
  return ImportOptionsSchema.parse(patch);
}

describe('batch write', () => {
  it('writes contacts and the checkpoint in one transaction', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [ok('a@x.cz', 1), ok('b@x.cz', 2)],
      inputRows: 2,
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

/**
 * Uložené volby importu na datech, ne na tvaru vstupu.
 *
 * Tahle sada MUSÍ být proti databázi. Vada, kterou hlídá, spočívala v tom, že se volby
 * korektně uložily, korektně zvalidovaly a při zápisu dávky se prostě nepoužily: do
 * `upsertContacts` šel jen kontakt. Test nad čistou funkcí by tvrdil, že `writeBatch`
 * dostal správný vstup, a přesně to platilo i před opravou. Poznat to jde jedině tak,
 * že se po importu někdo zeptá tabulek `list_subscriptions`, `contact_tags` a `consents`.
 */
describe('batch write applies the saved options', () => {
  it('subscribes the contacts into the chosen list instead of leaving it empty', async () => {
    const own = await testContext();
    const listId = await createList(own, 'double');
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ list_ids: [listId] }),
      rows: [ok('sub@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    const subscriptions = await subscriptionsOf(own, 'sub@x.cz');
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      list_id: listId,
      status: 'pending',
      source: 'import',
    });
  });

  it('confirms the subscription only with the declaration, and records when it happened', async () => {
    const own = await testContext();
    const listId = await createList(own, 'double');
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({
        list_ids: [listId],
        subscription_status: 'confirmed',
        consent: withConsent,
      }),
      rows: [{ ...ok('conf@x.cz', 1), consent: withConsent }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    const subscriptions = await subscriptionsOf(own, 'conf@x.cz');
    expect(subscriptions[0]?.status).toBe('confirmed');
    expect(subscriptions[0]?.confirmed_at).not.toBeNull();
  });

  it('leaves a double opt-in list at pending when the declaration is missing', async () => {
    const own = await testContext();
    const listId = await createList(own, 'double');
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      // Stav „potvrzené" bez prohlášení. O výsledku rozhoduje automat, ne volba.
      options: options({ list_ids: [listId], subscription_status: 'confirmed' }),
      rows: [ok('nodecl@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    expect((await subscriptionsOf(own, 'nodecl@x.cz'))[0]?.status).toBe('pending');
  });

  it('NEVRACÍ odhlášeného člověka do rozesílky, ani s prohlášením', async () => {
    const own = await testContext();
    const listId = await createList(own, 'single');
    const importId = await createImportRow(own);
    const first = {
      ...base,
      importId,
      options: options({ list_ids: [listId] }),
      rows: [ok('gone@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    };
    await writeBatch(own, first);
    await withWorkspace(own, (tx) =>
      tx.execute(sql`
        UPDATE list_subscriptions SET status = 'unsubscribed', unsubscribed_at = now()
         WHERE workspace_id = ${own.workspaceId}::uuid AND list_id = ${listId}::uuid`),
    );

    // Tentýž soubor podruhé, tentokrát s prohlášením a se stavem „potvrzené".
    await writeBatch(own, {
      ...first,
      options: options({
        list_ids: [listId],
        subscription_status: 'confirmed',
        consent: withConsent,
      }),
      rows: [{ ...ok('gone@x.cz', 1), consent: withConsent }],
      checkpointRow: 2,
    });

    // Návrat je vždycky přes pending, tedy přes projev vůle příjemce.
    expect((await subscriptionsOf(own, 'gone@x.cz'))[0]?.status).toBe('pending');
  });

  it('adds the tags from the options and from the file column', async () => {
    const own = await testContext();
    const tagId = await createTagRow(own, 'import-2026-08-01');
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ tag_ids: [tagId] }),
      rows: [{ ...ok('tagged@x.cz', 1), tags: ['VIP', 'veletrh'] }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    expect(await tagNamesOf(own, 'tagged@x.cz')).toEqual(['VIP', 'import-2026-08-01', 'veletrh']);
  });

  it('survives a tag that was deleted between the options step and the run', async () => {
    const own = await testContext();
    const tagId = await createTagRow(own, 'zmizel');
    await withWorkspace(own, (tx) => tx.execute(sql`DELETE FROM tags WHERE id = ${tagId}::uuid`));
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ tag_ids: [tagId] }),
      rows: [ok('stale-tag@x.cz', 1)],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    // Import doběhne. Kdyby se neexistující id poslalo do contact_tags, cizí klíč
    // by shodil celou dávku a job s retryLimit = 0 by se už nerozjel.
    expect(await tagNamesOf(own, 'stale-tag@x.cz')).toEqual([]);
    expect(Number((await readImport(own, importId)).created_rows)).toBe(1);
  });

  it('records the consent from the options, with the declaration in the evidence', async () => {
    const own = await testContext();
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ consent: withConsent }),
      rows: [{ ...ok('consent@x.cz', 1), consent: withConsent }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    const consents = await consentsOf(own, 'consent@x.cz');
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({
      purpose: 'email_marketing',
      status: 'granted',
      legal_basis: 'consent',
      // Kanál patří do sloupce s číselníkem, uživatelův popis původu do evidence.
      source: 'import',
      source_ref: importId,
    });
    expect(consents[0]?.evidence).toMatchObject({
      declaration: true,
      declared_source: 'veletrh Brno 2026',
      import_id: importId,
    });
    // Segmentace čte odvozený stav, ne append-only log. Musí vzniknout v téže transakci.
    expect(await consentStateOf(own, 'consent@x.cz')).toMatchObject({ status: 'granted' });
  });

  it('writes nothing extra for a softly suppressed row: no list, no consent', async () => {
    const own = await testContext();
    const listId = await createList(own, 'single');
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ list_ids: [listId], consent: withConsent }),
      // Tak vypadá řádek, jehož adresa je na suppression listu z mírného důvodu:
      // kontakt se zapíše, ale přihlášení ani souhlas dostat nesmí.
      rows: [{ ...ok('soft@x.cz', 1), subscribe: false, consent: null }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    expect(await subscriptionsOf(own, 'soft@x.cz')).toEqual([]);
    expect(await consentsOf(own, 'soft@x.cz')).toEqual([]);
    expect(Number((await readImport(own, importId)).created_rows)).toBe(1);
  });

  it('subscribes into a list that came from the mapped column, not just from the options', async () => {
    const own = await testContext();
    const fromOptions = await createList(own, 'double', `volby ${Math.random()}`);
    const fromColumn = await createList(own, 'double', `sloupec ${Math.random()}`);
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ list_ids: [fromOptions] }),
      rows: [{ ...ok('bothlists@x.cz', 1), listIds: [fromColumn] }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    expect((await subscriptionsOf(own, 'bothlists@x.cz')).map((s) => s.list_id).sort()).toEqual(
      [fromOptions, fromColumn].sort(),
    );
  });

  it('records the consent with the date from the file, not with today', async () => {
    const own = await testContext();
    const importId = await createImportRow(own);

    await writeBatch(own, {
      ...base,
      importId,
      options: options({ consent: withConsent }),
      rows: [
        {
          ...ok('old-consent@x.cz', 1),
          consent: withConsent,
          consentOccurredAt: '2019-04-02T00:00:00.000Z',
        },
      ],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    const { rows } = await withWorkspace(own, (tx) =>
      tx.execute<{ occurred_at: string | Date }>(sql`
        SELECT k.occurred_at FROM consents k JOIN contacts c ON c.id = k.contact_id
         WHERE k.workspace_id = ${own.workspaceId}::uuid AND c.email = 'old-consent@x.cz'::citext`),
    );
    expect(new Date(String(rows[0]?.occurred_at)).getUTCFullYear()).toBe(2019);
  });

  it('keeps the tag limit per contact and says so instead of exceeding it quietly', async () => {
    const own = await testContext();
    const importId = await createImportRow(own);
    // O jeden štítek víc, než kontakt unese.
    const names = Array.from({ length: 51 }, (_, i) => `stitek-${i}`);

    await writeBatch(own, {
      ...base,
      importId,
      rows: [{ ...ok('manytags@x.cz', 7), tags: names }],
      checkpointRow: 1,
      checkpointByte: 10,
    });

    expect(await tagNamesOf(own, 'manytags@x.cz')).toHaveLength(50);
    const row = await readImport(own, importId);
    // Přebytek se nezahodí potichu: je vidět v počtu varování i v souhrnu.
    expect(Number(row.warning_rows)).toBe(1);
    expect(row.error_summary['contact_tag_limit_reached']).toBe(1);
    const { rows } = await withWorkspace(own, (tx) =>
      tx.execute<{ row_number: number; severity: string }>(sql`
        SELECT row_number, severity FROM import_errors
         WHERE import_id = ${importId}::uuid AND error_code = 'contact_tag_limit_reached'`),
    );
    expect(rows[0]).toMatchObject({ severity: 'warning' });
    expect(Number(rows[0]?.row_number)).toBe(7);
  });

  it('pairs the tags with contacts by address, not by position in the batch', async () => {
    const own = await testContext();
    const importId = await createImportRow(own);
    // Adresa se stížností se do contacts vůbec nezapíše, takže výsledek upsertu je
    // o řádek kratší než dávka. Kdyby se párovalo podle pořadí, štítek „druhy" by
    // skončil u prvního kontaktu.
    await addSuppression(own, { email: 'blocked@x.cz', reason: 'complaint', source: 'manual' });

    await writeBatch(own, {
      ...base,
      importId,
      rows: [
        { ...ok('blocked@x.cz', 1), tags: ['prvni'] },
        { ...ok('druhy@x.cz', 2), tags: ['druhy'] },
      ],
      checkpointRow: 2,
      checkpointByte: 20,
    });

    expect(await tagNamesOf(own, 'druhy@x.cz')).toEqual(['druhy']);
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

  /**
   * Druhé nahrání téhož souboru nad ROZDĚLANÝM importem končilo pětistovkou:
   * kontrola duplicity koukala jen na stavy completed, completed_with_errors
   * a importing, kdežto `uq_imports__workspace_idempotency` je nepodmíněný,
   * takže INSERT spadl na 23505 a uživatel dostal „Nepodařilo se uložit soubor".
   */
  it('offers the unfinished import instead of failing on the unique index', async () => {
    const own = await testContext();
    const first = await createImport(own, { stream: csv(), filename: 'rozdelany.csv' });
    await readyForConfirm(own, first.id);
    expect(await codeOf(createImport(own, { stream: csv(), filename: 'rozdelany.csv' }))).toBe(
      'import_duplicate',
    );
  });

  /** Opakovat zrušený běh je legitimní a nikdo se na to nemá ptát. */
  it('repeats a cancelled import without asking', async () => {
    const own = await testContext();
    const first = await createImport(own, { stream: csv(), filename: 'zruseny.csv' });
    await readyForConfirm(own, first.id);
    await cancelImport(own, first.id);
    const second = await createImport(own, { stream: csv(), filename: 'zruseny.csv' });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
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
 * NÁLEZ PROTI P03, UZAVŘENÝ. Rozhodnutí R18 počítalo s politikou nad `imports`,
 * aby šel udělat sken napříč projekty, a žádná migrace ji nedodala. Sken proto
 * běžel pod `withoutContext`, tedy pod `mlain_app` bez kontextu projektu, kde
 * `ws_isolation` vyloučí všechny řádky. Zaseknuté importy se neobnovily
 * a projekt měl navždy obsazený stav `importing`, takže v něm `confirmImport`
 * odmítal každý další import.
 *
 * Politiku a SLOUPCOVÝ grant pod rolí `mlain_maintenance` dodává migrace 0024,
 * sken se přestěhoval do `platform/maintenance-scan.ts`. Test se proto změnil
 * přesně tak, jak ta poznámka předpovídala: z „selže hlasitě" na „obnoví
 * zaseknutý import".
 *
 * Ptá se DAT, ne strážce: dva projekty, v každém zaseknutý import, čekám obojí.
 * Kdyby se ptal jen strážce, ověřoval by tutéž úvahu, ze které strážce vznikl.
 */
describe('crash recovery', () => {
  it('requeues stale imports across workspaces, never reports a silent zero', async () => {
    const a = await testContext();
    const b = await testContext();
    const staleA = await createImportRow(a);
    const staleB = await createImportRow(b);
    await setImportState(a, staleA, {
      status: 'importing',
      updatedAtMinutesAgo: 30,
      checkpointRow: 4,
    });
    await setImportState(b, staleB, { status: 'importing', updatedAtMinutesAgo: 30 });
    // Čerstvý import v jednom z projektů: sken ho vzít NESMÍ, jinak by obnova
    // sahala na import, který právě běží.
    const fresh = await createImportRow(a);
    await setImportState(a, fresh, { status: 'importing', updatedAtMinutesAgo: 1 });

    const requeued: string[] = [];
    const count = await recoverStaleImports({ staleMinutes: 10 }, async (payload) => {
      requeued.push(payload.importId);
    });

    expect(requeued).toContain(staleA);
    expect(requeued).toContain(staleB);
    expect(requeued).not.toContain(fresh);
    expect(count).toBeGreaterThanOrEqual(2);
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

  /**
   * Celá cesta od volby uživatele k datům, jedním průchodem: PATCH uloží volby,
   * confirm spustí import, worker přečte soubor a zapíše dávku. Kdyby se kterýkoli
   * z těch článků rozešel (a přesně to se stalo mezi `imports.options` a `writeBatch`),
   * kontakty by vznikly a seznam by po úspěšném importu zůstal prázdný.
   */
  it('carries the saved options all the way to the data: list, tag and consent', async () => {
    const own = await testContext();
    const listId = await createList(own, 'double');
    const tagId = await createTagRow(own, 'import-brno');
    const created = await createImport(own, {
      stream: Readable.from([Buffer.from(WHOLE_FILE, 'utf8')]),
      filename: 'options.csv',
    });
    await detectAndPreview(own, created.id);
    await patchImport(own, created.id, {
      options: options({
        list_ids: [listId],
        subscription_status: 'confirmed',
        tag_ids: [tagId],
        consent: withConsent,
      }),
    });
    await confirmImport(own, created.id);

    const out = await runImport({
      data: { workspaceId: own.workspaceId, importId: created.id, phase: 'run' },
    });

    expect(out.processed).toBe(2);
    expect((await subscriptionsOf(own, 'a@x.cz'))[0]).toMatchObject({
      list_id: listId,
      status: 'confirmed',
    });
    expect(await tagNamesOf(own, 'a@x.cz')).toEqual(['import-brno']);
    expect((await consentsOf(own, 'b@x.cz'))[0]).toMatchObject({
      source: 'import',
      legal_basis: 'consent',
      status: 'granted',
    });
  });

  /**
   * NAHRÁNÍ SOUBORU IMPORT NESPOUŠTÍ.
   *
   * Do 5. 8. 2026 to dělalo přesně tohle: `createImport()` zařazovalo úlohu
   * s `phase: 'validate'`, obsluha na `phase` nekoukala a naimportovala celý
   * soubor s VÝCHOZÍMI volbami, tedy bez seznamu, bez štítku a bez souhlasu,
   * ještě než se uživatel proklikal ke krokům Mapování a Volby. Ověřeno
   * v prohlížeči: pět kontaktů bylo v databázi dvě vteřiny po nahrání a krok
   * Kontrola souboru pak spadl na 409 z `completed`.
   */
  it('writes nothing for an import that nobody confirmed', async () => {
    const own = await testContext();
    const created = await createImport(own, {
      stream: Readable.from([Buffer.from(WHOLE_FILE, 'utf8')]),
      filename: 'unconfirmed.csv',
    });
    await detectAndPreview(own, created.id);

    const out = await runImport({
      data: { workspaceId: own.workspaceId, importId: created.id, phase: 'run' },
    });

    expect(out.processed).toBe(0);
    expect(await contactEmails(own)).toEqual([]);
    const { rows } = await withWorkspace(own, (tx) =>
      tx.execute<{ status: string }>(
        sql`SELECT status FROM imports WHERE id = ${created.id}::uuid`,
      ),
    );
    expect(rows[0]?.status).toBe('previewing');
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

/**
 * POČÍTADLO PRŮBĚHU. Číslo „X z Y" je jediné, co o běžícím importu člověk vidí,
 * takže nesmyslná hodnota je vada, i když se kontakty zapíšou správně.
 *
 * Do 7. 8. 2026 se počítalo jako `rows.length + errors.length`. Naměřeno na třech
 * dokončených importech ve vývojové databázi: 25 z 20, 4 ze 3 a 2 z 1, všude s nulou
 * chyb. Rozdíl nebyl konstantní, takže to nevypadalo na záměnu hlavičky za řádek.
 */
describe('processed_rows: počítadlo průběhu', () => {
  it('řádek se zapsaným kontaktem A VAROVÁNÍM se počítá JEDNOU', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      // Jeden přečtený řádek, který se zapsal a zároveň nese varování.
      rows: [ok('v@x.cz', 1)],
      errors: [err(1, 'gender_unknown', 'warning')],
      inputRows: 1,
      checkpointRow: 1,
      checkpointByte: 10,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.processed_rows)).toBe(1);
    // Varování se přitom NEZTRATÍ, jen se nepřičte do průběhu.
    expect(Number(row.warning_rows)).toBe(1);
  });

  it('řádek na POTLAČENÉ adrese se do průběhu započítá, i když se nezapsal', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: [],
      errors: [],
      // Přečtený řádek, který skončil na blokovaných adresách: není ani mezi
      // zapsanými, ani mezi chybnými, a přesto ze souboru zmizel.
      inputRows: 1,
      suppressedCount: 1,
      checkpointRow: 1,
      checkpointByte: 10,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.processed_rows)).toBe(1);
    expect(Number(row.suppressed_rows)).toBe(1);
  });

  it('průběh nikdy nepřeskočí přes celkový počet řádků souboru', async () => {
    const importId = await createImportRow(ctx);
    // Dvacet přečtených řádků, z toho pět s varováním. Přesně ten tvar, který
    // ve vývojové databázi hlásil „25 z 20".
    await writeBatch(ctx, {
      ...base,
      importId,
      rows: Array.from({ length: 20 }, (_, i) => ok(`p${i}@x.cz`, i + 1)),
      errors: Array.from({ length: 5 }, (_, i) => err(i + 1, 'gender_unknown', 'warning')),
      inputRows: 20,
      checkpointRow: 20,
      checkpointByte: 400,
    });
    const row = await readImport(ctx, importId);
    expect(Number(row.processed_rows)).toBe(20);
  });
});
