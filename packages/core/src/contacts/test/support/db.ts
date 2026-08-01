import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll } from 'vitest';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import type { WorkspaceContext } from '../../../identity/types';
import { createWorkspaceContext } from '../../../identity/context';
import { hashPassword } from '../../../identity/password';
import { startPgHarness, type PgHarness } from '../../../test-support/pg-harness';
import { appPool, closePools, withoutContext } from '../../../tx';
import { resetEnqueueConfig } from '../../jobs/enqueue';
import { writeContact } from '../../repo/contacts';

/**
 * Jediný bootstrap databázových testů domény kontaktů.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán stavěl na `startHarness()`
 * a `seedTwoWorkspaces()` z `@mlain/db/test-support`. Balíček `@mlain/db` takový klíč
 * v `exports` nemá a mít ho zatím nebude, protože ten řádek vlastní P03. Používá se proto
 * `startPgHarness()` z `packages/core/src/test-support/pg-harness.ts`, tedy hotový harness,
 * pod kterým dnes běží databázové testy identity, auditu i platformy. Je to táž věc pod
 * jiným jménem: kontejner PostgreSQL 18, šest rolí, migrace pod `mlain_migrator`
 * a aplikační spojení pod `mlain_app`.
 *
 * Druhá odchylka je pg-boss. Testy zařazení jobů se ptají tabulky `pgboss.job`, jenže
 * schéma pg-boss zakládá až worker při startu. Harness ho proto nainstaluje sám a založí
 * fronty, které tahle doména plní. Bez toho by `enqueue` spadlo na chybějící tabulku
 * a test by nedokázal rozlišit "job se nezařadil" od "schéma neexistuje".
 */

/** Fronty, do kterých tahle doména zařazuje joby. Musí existovat, `job.name` má cizí klíč. */
const QUEUES_USED = [
  'contacts.strip_attribute',
  'contacts.bulk_tag',
  'contact_fields.verify_index',
  'content.revalidate_templates',
  'segments.mark_invalid',
];

let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let appRolePool: Pool | null = null;
let seedUserId = '';

beforeAll(async () => {
  harness = await startPgHarness();
  resetEnqueueConfig();
  await closePools();

  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });
  appRolePool = new Pool({ connectionString: harness.appUrl, max: 4 });

  await installPgBoss(harness.migratorUrl, migratorPool);

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx
      .insert(schema.users)
      .values({
        email: `contacts-${process.pid}-${Date.now()}@example.cz`,
        passwordHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return inserted[0]!.id;
  });
}, 300_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await appRolePool?.end();
  await harness?.stop();
  harness = null;
}, 120_000);

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

  // Aplikační role musí do fronty smět zapsat. V produkci to řeší grant v initdb;
  // harness ho dělá tady, aby test běžel pod TOU ROLÍ, pod kterou běží produkce.
  await migrator.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
  await migrator.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
  );
}

function h(): PgHarness {
  if (harness === null) throw new Error('harness není nastartovaný; chybí import support/db.js');
  return harness;
}

/** Pool pod migrátorskou rolí. Používá se na přípravu dat a na kontrolní dotazy. */
export function asMigrator(): Pool {
  h();
  if (migratorPool === null) throw new Error('migrátorský pool není otevřený');
  return migratorPool;
}

/** Pool pod aplikační rolí, tedy pod tou, pod kterou běží produkce. */
export function asAppRole(): Pool {
  h();
  if (appRolePool === null) throw new Error('aplikační pool není otevřený');
  return appRolePool;
}

let workspaceCounter = 0;

/**
 * Čerstvý projekt pro jeden test. Každé volání zakládá NOVÝ projekt, takže testy
 * na sobě nezávisí a nemusí se mezi nimi mazat tabulky. Je to levnější než TRUNCATE
 * napříč sedmdesáti tabulkami a odolnější: test, který zapomene uklidit, neshodí další.
 */
export async function testContext(): Promise<WorkspaceContext> {
  workspaceCounter += 1;
  const slug = `ws-${process.pid}-${Date.now()}-${workspaceCounter}`.slice(0, 62);
  const workspace = await createWorkspaceAsUser(appPool(), seedUserId, {
    name: `Test ${workspaceCounter}`,
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

export type TestWorkspace = {
  ctx: WorkspaceContext;
  cleanup(): Promise<void>;
  truncate(tables: readonly string[]): Promise<void>;
  auditActions(): Promise<string[]>;
  lastAuditTargetId(): Promise<string | null>;
  seedSubscriptions(listId: string, statuses: readonly string[]): Promise<void>;
};

/** Projekt s pomůckami, které potřebují testy fáze C. */
export async function createTestWorkspace(): Promise<TestWorkspace> {
  const ctx = await testContext();
  return {
    ctx,
    cleanup: async () => {
      await asMigrator().query(`DELETE FROM workspaces WHERE id = $1`, [ctx.workspaceId]);
    },
    truncate: async (tables) => {
      for (const table of tables) {
        await asMigrator().query(`DELETE FROM ${table} WHERE workspace_id = $1`, [ctx.workspaceId]);
      }
    },
    auditActions: async () => {
      const { rows } = await asMigrator().query<{ action: string }>(
        `SELECT action FROM audit_log WHERE workspace_id = $1 ORDER BY created_at, id`,
        [ctx.workspaceId],
      );
      return rows.map((r) => r.action);
    },
    lastAuditTargetId: async () => {
      const entry = await lastAuditEntry(ctx);
      return entry?.target_id ?? null;
    },
    seedSubscriptions: async (listId, statuses) => {
      for (const [index, status] of statuses.entries()) {
        const contact = await createActiveContact(ctx, `sub-${index}-${Date.now()}@x.cz`);
        await createSubscription(ctx, { contactId: contact.id, listId, status });
      }
    },
  };
}

export type ContactRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  greeting: string;
  greeting_neutral: string;
  attributes: Record<string, unknown>;
  email_fingerprints: Buffer[];
  deleted_at: Date | null;
};

/**
 * Kontrolní čtení jde přes migrátorský pool schválně: nesmí ho ovlivnit tatáž RLS
 * politika, kterou používá testovaný kód, jinak by test potvrdil izolaci sám sobě.
 */
export async function findByEmailOrNull(
  ctx: WorkspaceContext,
  email: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ContactRow | null> {
  const { rows } = await asMigrator().query<ContactRow>(
    `SELECT * FROM contacts
      WHERE workspace_id = $1 AND email = $2
        AND ($3 OR deleted_at IS NULL)
      ORDER BY deleted_at NULLS FIRST
      LIMIT 1`,
    [ctx.workspaceId, email, options.includeDeleted ?? false],
  );
  return rows[0] ?? null;
}

export async function findByEmail(
  ctx: WorkspaceContext,
  email: string,
  options: { includeDeleted?: boolean } = {},
): Promise<ContactRow> {
  const row = await findByEmailOrNull(ctx, email, options);
  if (row === null) throw new Error(`kontakt ${email} v projektu ${ctx.workspaceId} není`);
  return row;
}

export async function softDelete(ctx: WorkspaceContext, email: string): Promise<void> {
  await asMigrator().query(
    `UPDATE contacts SET deleted_at = now(), status = 'deleted'
      WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email],
  );
}

export async function lastAuditEntry(
  ctx: WorkspaceContext,
): Promise<{ action: string; target_id: string; metadata: Record<string, unknown> } | null> {
  const { rows } = await asMigrator().query<{
    action: string;
    target_id: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT action, target_id, metadata FROM audit_log
      WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [ctx.workspaceId],
  );
  return rows[0] ?? null;
}

/** Fronty zařazené v testu. Čte se přímo z pg-boss tabulky, ne z odposlechu volání. */
export async function enqueuedJobs(name?: string): Promise<{ name: string; data: unknown }[]> {
  const { rows } = await asMigrator().query<{ name: string; data: unknown }>(
    `SELECT name, data FROM pgboss.job ${name === undefined ? '' : 'WHERE name = $1'}
      ORDER BY created_on`,
    name === undefined ? [] : [name],
  );
  return rows;
}

/**
 * Názvy jobů zařazených pro daný projekt. Testy je porovnávají jako množinu.
 *
 * Bere `WorkspaceContext`, ne holý řetězec, a je to záměr, ne kosmetika: `scope.test.ts`
 * hlídá, že exportovaná funkce mimo `packages/core/src/tx` nebere `workspaceId: string`.
 * Kdyby ho brala, byl by to další vstup, kterým se dá kontext izolace obejít.
 */
export async function enqueuedJobNames(ctx: WorkspaceContext): Promise<string[]> {
  const { rows } = await asMigrator().query<{ name: string }>(
    `SELECT name FROM pgboss.job WHERE data ->> 'workspaceId' = $1 ORDER BY created_on`,
    [ctx.workspaceId],
  );
  return rows.map((r) => r.name);
}

export async function countContacts(ctx: WorkspaceContext): Promise<number> {
  const { rows } = await asMigrator().query<{ total: string }>(
    `SELECT count(*) AS total FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL`,
    [ctx.workspaceId],
  );
  return Number(rows[0]!.total);
}

export async function setStatus(
  ctx: WorkspaceContext,
  email: string,
  status: string,
): Promise<void> {
  await asMigrator().query(
    `UPDATE contacts SET status = $3 WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email, status],
  );
}

export async function setAddressForm(
  ctx: WorkspaceContext,
  addressForm: 'formal' | 'informal',
): Promise<void> {
  await asMigrator().query(`UPDATE workspaces SET address_form = $2 WHERE id = $1`, [
    ctx.workspaceId,
    addressForm,
  ]);
}

export async function changeEmailDirectly(
  ctx: WorkspaceContext,
  contactId: string,
  email: string,
): Promise<void> {
  await asMigrator().query(`UPDATE contacts SET email = $3 WHERE workspace_id = $1 AND id = $2`, [
    ctx.workspaceId,
    contactId,
    email,
  ]);
}

export async function setProcessingRestricted(
  ctx: WorkspaceContext,
  contactId: string,
  value: boolean,
): Promise<void> {
  await asMigrator().query(
    `UPDATE contacts SET processing_restricted = $3 WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, contactId, value],
  );
}

/** Kontakt ve stavu active. Zápis ho zakládá jako unconfirmed (pravidlo 3), proto UPDATE. */
export async function createActiveContact(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ id: string }> {
  const written = await writeContact(ctx, { email, attributes: {} });
  if (written.rejected !== null) throw new Error(`kontakt ${email} byl potlačený`);
  await setStatus(ctx, email, 'active');
  return { id: written.id };
}

export async function createList(
  ctx: WorkspaceContext,
  input: { name: string; optIn?: 'single' | 'double' },
): Promise<{ id: string }> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO lists (workspace_id, name, opt_in) VALUES ($1, $2, $3) RETURNING id`,
    [ctx.workspaceId, input.name, input.optIn ?? 'double'],
  );
  return { id: rows[0]!.id };
}

export async function createSubscription(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string; status: string; snoozeUntil?: Date },
): Promise<void> {
  await asMigrator().query(
    `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source, snooze_until)
     VALUES ($1, $2, $3, $4, 'manual', $5)
     ON CONFLICT (contact_id, list_id) DO UPDATE SET status = excluded.status,
       snooze_until = excluded.snooze_until`,
    [input.contactId, input.listId, ctx.workspaceId, input.status, input.snoozeUntil ?? null],
  );
}

export async function countContactTags(ctx: WorkspaceContext, contactId: string): Promise<number> {
  const { rows } = await asMigrator().query<{ total: string }>(
    `SELECT count(*) AS total FROM contact_tags WHERE workspace_id = $1 AND contact_id = $2`,
    [ctx.workspaceId, contactId],
  );
  return Number(rows[0]!.total);
}

export async function tagExists(ctx: WorkspaceContext, tagId: string): Promise<boolean> {
  const { rows } = await asMigrator().query(
    `SELECT 1 FROM tags WHERE workspace_id = $1 AND id = $2`,
    [ctx.workspaceId, tagId],
  );
  return rows.length > 0;
}

export async function contactHasTag(
  ctx: WorkspaceContext,
  contactId: string,
  tagId: string,
): Promise<boolean> {
  const { rows } = await asMigrator().query(
    `SELECT 1 FROM contact_tags WHERE workspace_id = $1 AND contact_id = $2 AND tag_id = $3`,
    [ctx.workspaceId, contactId, tagId],
  );
  return rows.length > 0;
}

export async function countContactsWithAttribute(
  ctx: WorkspaceContext,
  key: string,
): Promise<number> {
  const { rows } = await asMigrator().query<{ total: string }>(
    `SELECT count(*) AS total FROM contacts
      WHERE workspace_id = $1 AND deleted_at IS NULL AND attributes ? $2`,
    [ctx.workspaceId, key],
  );
  return Number(rows[0]!.total);
}

export async function seedContactsWithAttribute(
  ctx: WorkspaceContext,
  key: string,
  value: string,
  count: number,
): Promise<void> {
  await asMigrator().query(
    `INSERT INTO contacts (workspace_id, email, attributes, status)
     SELECT $1, 'seed-' || g || '-' || $4 || '@x.cz', jsonb_build_object($2::text, $3::text), 'active'
       FROM generate_series(1, $5) AS g`,
    [ctx.workspaceId, key, value, Date.now(), count],
  );
}

export async function createFormWritingTo(
  ctx: WorkspaceContext,
  key: string,
): Promise<{ id: string }> {
  const slug = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 24);
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO forms (workspace_id, name, slug, fields)
     VALUES ($1, 'Formulář', $2, $3::jsonb) RETURNING id`,
    [ctx.workspaceId, slug, JSON.stringify([{ key, type: 'text' }])],
  );
  return { id: rows[0]!.id };
}

export async function createScheduledCampaignUsing(
  ctx: WorkspaceContext,
  path: string,
): Promise<{ id: string }> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO campaigns (workspace_id, name, status, scheduled_at, schedule_timezone, compiled_fields)
     VALUES ($1, 'Kampaň', 'scheduled', now() + interval '1 day', 'Europe/Prague', $2)
     RETURNING id`,
    [ctx.workspaceId, [path]],
  );
  return { id: rows[0]!.id };
}

export async function indexNamesOnContacts(): Promise<string[]> {
  const { rows } = await asMigrator().query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'contacts' ORDER BY indexname`,
  );
  return rows.map((r) => r.indexname);
}

export async function explainAttributeLookup(
  ctx: WorkspaceContext,
  key: string,
  value: string,
): Promise<string> {
  // Sekvenční průchod se vypíná jen pro tenhle dotaz, aby se plánovač u malé tabulky
  // nerozhodl index ignorovat kvůli velikosti, ne kvůli tomu, že by ho nemohl použít.
  const client = await asMigrator().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM contacts
        WHERE workspace_id = $1 AND attributes @> jsonb_build_object($2::text, $3::text)`,
      [ctx.workspaceId, key, value],
    );
    await client.query('ROLLBACK');
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  } finally {
    client.release();
  }
}
