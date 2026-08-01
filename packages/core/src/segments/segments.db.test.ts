import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { createWorkspaceContext } from '../identity/context';
import { hashPassword } from '../identity/password';
import type { WorkspaceContext } from '../identity/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, pgErrorCode, withWorkspace, withoutContext } from '../tx';
import type { ConditionNode, SegmentAst } from './ast';
import { compileSegmentSql } from './compile/index';
import { buildEnvelope } from './compile/envelope';
import { ParamBag, toSql } from './compile/params';
import { COMBOS, fieldFor, UUID_A, UUID_B, valueFor } from './test-support/combos';
import { resolveReferences } from './references';
import { compileAudienceToSql, countSegment, listSegmentContacts } from './repo';
import { runCountWithEstimate, runReadOnly } from './sql-runner';
import {
  createSegment,
  freezeSegment,
  listSegments,
  markAllStale,
  recountSegment,
  updateSegment,
} from './service';
import { audienceBreakdown, INERT_GATES } from './audience';
import { diagnoseEmptyResult } from './diagnostics';
import { handler as cleanupHandler } from './jobs/cleanup-after-reactivation';
import { scheduleStale } from './jobs/recount';
import { resetSegmentEnqueueConfig } from './jobs/enqueue';
import { segmentErrorCode } from './errors';

/**
 * Databázová sada segmentů. Jeden kontejner na celý soubor, protože start
 * PostgreSQL 18 s migracemi stojí desítky sekund a osm samostatných souborů by
 * ho zaplatilo osmkrát.
 *
 * Nejdůležitější blok je „every compiled predicate parses and plans". Sada
 * invariantů nad textem dotazu (`sql-invariants.test.ts`) je grep a grepem
 * projde i SQL, které PostgreSQL odmítne: chybějící `::timestamptz` u `$2`,
 * `jsonb_build_object` bez castu, sloupec, který ve schématu není. Přesně tohle
 * je scénář OB-00. Kombinace pole a operátoru se proto berou ze STEJNÉHO zdroje
 * (matice v `operators.ts`) a každá se pošle databázi k naplánování.
 */

/** Fronty, do kterých tahle doména zařazuje joby. `job.name` má cizí klíč na `queue.name`. */
const QUEUES_USED = ['segments.recount', 'contacts.cleanup_after_reactivation'];

let harness: PgHarness | null = null;
let migratorPool: Pool | null = null;
let seedUserId = '';
let workspaceCounter = 0;

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

beforeAll(async () => {
  harness = await startPgHarness();
  resetSegmentEnqueueConfig();
  await closePools();

  migratorPool = new Pool({ connectionString: harness.migratorUrl, max: 4 });
  await installPgBoss(harness.migratorUrl, migratorPool);

  const passwordHash = await hashPassword('dostatecne-dlouhe-heslo');
  seedUserId = await withoutContext(async (tx) => {
    const inserted = await tx
      .insert(schema.users)
      .values({
        email: `segments-${process.pid}-${Date.now()}@example.cz`,
        passwordHash,
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return inserted[0]!.id;
  });
}, 1_800_000);

afterAll(async () => {
  await closePools();
  await migratorPool?.end();
  await harness?.stop();
  harness = null;
}, 600_000);

async function testContext(): Promise<WorkspaceContext> {
  workspaceCounter += 1;
  const slug = `seg-${process.pid}-${Date.now()}-${workspaceCounter}`.slice(0, 62);
  const { appPool } = await import('../tx');
  const workspace = await createWorkspaceAsUser(appPool(), seedUserId, {
    name: `Segmenty ${workspaceCounter}`,
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

async function seedContacts(
  ctx: WorkspaceContext,
  rows: { email: string; status?: string; attributes?: Record<string, unknown> }[],
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    for (const row of rows) {
      await tx.execute(sql`
        INSERT INTO contacts (workspace_id, email, status, attributes)
        VALUES (${ctx.workspaceId}::uuid, ${row.email}, ${row.status ?? 'active'},
                ${JSON.stringify(row.attributes ?? {})}::jsonb)`);
    }
  });
}

const asOf = new Date('2026-07-31T10:00:00Z');

const statusActive: SegmentAst = {
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
};

// ---------------------------------------------------------------------------
// 1. Každý zkompilovaný predikát musí projít parserem a plánovačem
// ---------------------------------------------------------------------------

function compileOptsFor(ctx: WorkspaceContext) {
  return {
    alias: 'a',
    paramOffset: 0,
    workspaceId: ctx.workspaceId,
    asOf,
    timezone: 'Europe/Prague',
    fieldClasses: {
      txt: 'text' as const,
      num: 'number' as const,
      dt: 'datetime' as const,
      ml: 'multi_enum' as const,
      bl: 'boolean' as const,
    },
    segmentKinds: { [UUID_B]: { kind: 'static' as const } },
  };
}

describe('every compiled predicate parses and plans against PostgreSQL', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(ctx, [{ email: 'plan@example.cz' }]);
  }, 600_000);

  it('covers the whole operator matrix, not a hand picked subset', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(COMBOS)('%s + %s is accepted by the planner', async (cls, operator) => {
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: fieldFor(cls),
            operator,
            ...valueFor(cls, operator),
          } as ConditionNode,
        ],
      },
    };
    const compiled = compileSegmentSql(ast, compileOptsFor(ctx));
    const bag = new ParamBag(0);
    bag.values.push(...compiled.params);
    const envelope = buildEnvelope('a', compiled.sql, bag);
    // EXPLAIN spustí parser, typovou dedukci i plánovač. Přesně ty tři kroky
    // grep nad textem přeskočí, a přesně v nich žijí 42P18, 42883 a 42703.
    await runReadOnly(ctx, (tx) => tx.execute(toSql(`EXPLAIN ${envelope}`, compiled.params)), {
      timeoutMs: 20_000,
    });
  });

  it.each([
    ['sent', { since_days: 45 }],
    ['sent', { campaign_id: UUID_A }],
    ['sent', { last_n_campaigns: 5 }],
    ['opened', { since_days: 45 }],
    ['opened', { campaign_id: UUID_A }],
    ['opened', { last_n_campaigns: 5 }],
    ['delivered', { since_days: 30 }],
    ['bounced', { since_days: 30 }],
  ] as const)('engagement %s with a slow scope also plans', async (metric, scope) => {
    for (const operator of ['did', 'did_not', 'count_gte'] as const) {
      const ast: SegmentAst = {
        version: 1,
        root: {
          type: 'group',
          op: 'and',
          children: [
            {
              type: 'condition',
              field: { kind: 'engagement', metric, scope },
              operator,
              ...(operator === 'count_gte' ? { value: 2 } : {}),
            } as ConditionNode,
          ],
        },
      };
      const compiled = compileSegmentSql(ast, compileOptsFor(ctx));
      const bag = new ParamBag(0);
      bag.values.push(...compiled.params);
      const envelope = buildEnvelope('a', compiled.sql, bag);
      await runReadOnly(ctx, (tx) => tx.execute(toSql(`EXPLAIN ${envelope}`, compiled.params)), {
        timeoutMs: 20_000,
      });
    }
  });

  it('plans a negated group, where the containment turns unknown aware', async () => {
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        not: true,
        children: [
          {
            type: 'condition',
            field: { kind: 'attribute', key: 'txt' },
            operator: 'eq',
            value: 'Praha',
          },
        ],
      },
    };
    const compiled = compileSegmentSql(ast, compileOptsFor(ctx));
    const bag = new ParamBag(0);
    bag.values.push(...compiled.params);
    await runReadOnly(
      ctx,
      (tx) =>
        tx.execute(toSql(`EXPLAIN ${buildEnvelope('a', compiled.sql, bag)}`, compiled.params)),
      { timeoutMs: 20_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Tříhodnotová logika: NOT nad neznámou hodnotou není true
// ---------------------------------------------------------------------------

describe('three valued logic against real rows', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        INSERT INTO contact_fields (workspace_id, key, type)
        VALUES (${ctx.workspaceId}::uuid, 'city', 'text')`),
    );
    await seedContacts(ctx, [
      { email: 'praha@example.cz', attributes: { city: 'Praha' } },
      { email: 'brno@example.cz', attributes: { city: 'Brno' } },
      { email: 'nikde@example.cz', attributes: {} },
    ]);
  }, 600_000);

  const cityEq = (not: boolean): SegmentAst => ({
    version: 1,
    root: {
      type: 'group',
      op: 'and',
      not,
      children: [
        {
          type: 'condition',
          field: { kind: 'attribute', key: 'city' },
          operator: 'eq',
          value: 'Praha',
        },
      ],
    },
  });

  it('matches only the contact whose value equals', async () => {
    const out = await countSegment(ctx, cityEq(false), { asOf, timeoutMs: 20_000 });
    expect(out).toMatchObject({ count: 1, exact: true });
  });

  it('does NOT return the contact with an unknown value under a negated group', async () => {
    const out = await countSegment(ctx, cityEq(true), { asOf, timeoutMs: 20_000 });
    // Brno ano, „nikde" ne. Kdyby se list srazil na false, bylo by tu 2
    // a segment by tvrdil, že kontakt bez vyplněného města v Praze není.
    expect(out.count).toBe(1);
    const rows = await listSegmentContacts(ctx, cityEq(true), { limit: 10 }, { asOf });
    expect(rows.rows.map((r) => r.email)).toEqual(['brno@example.cz']);
  });

  it('does NOT return the unknown contact for neq either', async () => {
    const neq: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'attribute', key: 'city' },
            operator: 'neq',
            value: 'Praha',
          },
        ],
      },
    };
    const rows = await listSegmentContacts(ctx, neq, { limit: 10 }, { asOf });
    expect(rows.rows.map((r) => r.email)).toEqual(['brno@example.cz']);
  });

  it('keeps the two complementary sets from covering the unknown row', async () => {
    const yes = await countSegment(ctx, cityEq(false), { asOf, timeoutMs: 20_000 });
    const no = await countSegment(ctx, cityEq(true), { asOf, timeoutMs: 20_000 });
    // Tři kontakty, ale doplňkové segmenty pokrývají jen dva. Ten třetí není
    // ani v jednom, protože o něm data neodpovídají, a to je správně.
    expect(yes.count + no.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Běhový adaptér
// ---------------------------------------------------------------------------

describe('sql runner', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(
      ctx,
      Array.from({ length: 5 }, (_, i) => ({ email: `runner-${i}@example.cz` })),
    );
  }, 600_000);

  it('refuses to write inside a preview transaction', async () => {
    const error = await runReadOnly(ctx, (tx) =>
      tx.execute(sql`INSERT INTO tags (workspace_id, name) VALUES (${ctx.workspaceId}::uuid, 'x')`),
    ).catch((e: unknown) => e);
    // Kód se čte přes pgErrorCode, NIKDY přes error.code: přes drizzle
    // je error.code undefined a kód leží na error.cause.code.
    expect(pgErrorCode(error)).toBe('25006');
  });

  it('returns zero rows without the workspace context', async () => {
    // Izolaci ověřuje test tím, že si transakci bez kontextu otevře SÁM.
    // Produkční runner na to volbu nemá a mít nesmí.
    const { rows } = await withoutContext((tx) => tx.execute(sql`SELECT id FROM contacts`));
    expect(rows).toHaveLength(0);
  });

  it('returns an exact count when the query finishes', async () => {
    const out = await runCountWithEstimate(
      ctx,
      'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1',
      [ctx.workspaceId],
      20_000,
    );
    expect(out).toEqual({ count: 5, exact: true, durationMs: expect.any(Number) });
  });

  it('falls back to an estimate when the statement timeout fires', async () => {
    const out = await runCountWithEstimate(
      ctx,
      'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1 AND pg_sleep(2) IS NOT NULL',
      [ctx.workspaceId],
      200,
    );
    expect(out.exact).toBe(false);
    expect(out.count).toBeGreaterThanOrEqual(0);
  });

  it('reads the result from .rows, so a count can never be silently undefined', async () => {
    // Regrese proti nejtiššímu tvaru téhle chyby: `(await tx.execute(...)) as Row[]`
    // projde typovou kontrolou a [0] je na něm VŽDY undefined, takže by
    // countSegment vracel nulu u každého segmentu a vypadalo by to jako
    // „segment je prázdný", ne jako chyba.
    const out = await runCountWithEstimate(
      ctx,
      'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1',
      [ctx.workspaceId],
      20_000,
    );
    expect(out.count).toBe(5);
    expect(out.count).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// 4. Vrstva 3: příslušnost k projektu a skutečná detekce cyklu
// ---------------------------------------------------------------------------

describe('reference resolution', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(ctx, [{ email: 'refs@example.cz' }]);
  }, 600_000);

  it('rejects a list id from a foreign workspace with 404, not an empty result', async () => {
    const other = await testContext();
    const listId = await withWorkspace(other, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO lists (workspace_id, name)
        VALUES (${other.workspaceId}::uuid, 'Cizí') RETURNING id`);
      return rows[0]!.id;
    });
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: { kind: 'list', list_id: listId }, operator: 'is_member' },
        ],
      },
    };
    const caught = await resolveReferences(ctx, ast).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('segment_reference_not_found');
    expect((caught as { status?: number }).status).toBe(404);
  });

  it('rejects an unknown custom field instead of compiling it as text', async () => {
    const ast: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'attribute', key: 'neexistuje' },
            operator: 'eq',
            value: 'x',
          },
        ],
      },
    };
    const caught = await resolveReferences(ctx, ast).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('segment_reference_not_found');
  });

  /**
   * DŮKAZ, že detekce cyklu není komentář.
   *
   * Cyklus se v provozu nezaloží najednou, ale ve dvou krocích: nejdřív B
   * odkáže na A, pak někdo přepíše A tak, aby odkazoval na B. Graf se přitom
   * skládá z ULOŽENÝCH definic, takže uzel A by v něm nesl svou starou definici
   * bez odkazu a smyčka by se nikde neuzavřela. Proto se uzel upravovaného
   * segmentu seřadí z NOVÉ definice, viz `ResolveOptions.selfId`.
   */
  it('rejects a cycle that is created in two steps, the way it happens in practice', async () => {
    const a = await createSegment(ctx, { name: 'Cyklus A', definition: statusActive });
    const refA: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: { kind: 'segment', segment_id: a.id }, operator: 'in' },
        ],
      },
    };
    const b = await createSegment(ctx, { name: 'Cyklus B', definition: refA });

    const refB: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: { kind: 'segment', segment_id: b.id }, operator: 'in' },
        ],
      },
    };
    const caught = await updateSegment(ctx, a.id, { definition: refB }).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('segment_cycle');

    // A definice A zůstala nedotčená, takže odmítnutí je opravdu odmítnutí.
    const rows = await withWorkspace(ctx, (tx) =>
      tx.execute<{ definition: SegmentAst }>(
        sql`SELECT definition FROM segments WHERE id = ${a.id}::uuid`,
      ),
    );
    expect(rows.rows[0]?.definition).toEqual(statusActive);
  });

  it('rejects a direct self reference', async () => {
    const a = await createSegment(ctx, { name: 'Sám na sebe', definition: statusActive });
    const selfRef: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: { kind: 'segment', segment_id: a.id }, operator: 'in' },
        ],
      },
    };
    const caught = await updateSegment(ctx, a.id, { definition: selfRef }).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('segment_cycle');
  });

  it('rejects nesting deeper than two levels of segments', async () => {
    const one = await createSegment(ctx, { name: 'Vnoření 1', definition: statusActive });
    const refTo = (id: string): SegmentAst => ({
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          { type: 'condition', field: { kind: 'segment', segment_id: id }, operator: 'in' },
        ],
      },
    });
    const two = await createSegment(ctx, { name: 'Vnoření 2', definition: refTo(one.id) });
    const three = await createSegment(ctx, { name: 'Vnoření 3', definition: refTo(two.id) });
    const caught = await createSegment(ctx, {
      name: 'Vnoření 4',
      definition: refTo(three.id),
    }).catch((e: unknown) => e);
    expect(segmentErrorCode(caught)).toBe('segment_nesting_too_deep');
  });
});

// ---------------------------------------------------------------------------
// 5. Služba
// ---------------------------------------------------------------------------

describe('segment service', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(
      ctx,
      Array.from({ length: 5 }, (_, i) => ({ email: `svc-${i}@example.cz` })),
    );
  }, 600_000);

  it('stores a definition hash and rejects a duplicate name', async () => {
    const created = await createSegment(ctx, { name: 'Aktivní', definition: statusActive });
    expect(created.definitionHash).toHaveLength(32);
    const caught = await createSegment(ctx, {
      name: 'aktivní',
      definition: statusActive,
    }).catch((e: unknown) => e);
    expect((caught as { status?: number }).status).toBe(409);
  });

  it('enqueues a recount in the same transaction as the insert', async () => {
    const created = await createSegment(ctx, { name: 'S frontou', definition: statusActive });
    const { rows } = await withoutContext((tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM pgboss.job
         WHERE name = 'segments.recount' AND data ->> 'segmentId' = ${created.id}`),
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1);
    expect(created.recomputeState).toBe('queued');
  });

  it('recomputes the hash and clears the cache when the definition changes', async () => {
    const created = await createSegment(ctx, { name: 'Změna', definition: statusActive });
    await recountSegment(ctx, created.id);
    const changed: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'contact', key: 'status' },
            operator: 'eq',
            value: 'bounced',
          },
        ],
      },
    };
    const updated = await updateSegment(ctx, created.id, { definition: changed });
    expect(updated.definitionHash.equals(created.definitionHash)).toBe(false);
    expect(updated.cachedAt).toBeNull();
    expect(updated.recomputeState).toBe('queued');
  });

  it('counts the same rows through countSegment as the envelope would send', async () => {
    const out = await countSegment(ctx, statusActive, { asOf, timeoutMs: 20_000 });
    expect(out).toMatchObject({ count: 5, exact: true });
  });

  it('freezes a dynamic segment into a static one with members', async () => {
    const created = await createSegment(ctx, { name: 'Ke zmrazení', definition: statusActive });
    const frozen = await freezeSegment(ctx, created.id, { name: 'Zmrazený' });
    expect(frozen.kind).toBe('static');
    expect(frozen.cachedCount).toBe(5);
    expect(frozen.cachedIsExact).toBe(true);
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM segment_members WHERE segment_id = ${frozen.id}::uuid`),
    );
    expect(rows[0]?.n).toBe(5);
  });

  it('marks every dynamic segment of the workspace as stale, but leaves a frozen one alone', async () => {
    const dynamic = await createSegment(ctx, { name: 'Zastarej', definition: statusActive });
    await recountSegment(ctx, dynamic.id);
    const frozen = await freezeSegment(ctx, dynamic.id, { name: 'Zmrazený druhý' });

    await markAllStale(ctx);

    const rows = await listSegments(ctx, { limit: 100 });
    const dyn = rows.rows.find((r) => r.id === dynamic.id);
    const stat = rows.rows.find((r) => r.id === frozen.id);
    expect(dyn?.cachedAt).toBeNull();
    // Statický segment je zmrazená množina, importem se nezmění, takže si
    // razítko zmrazení nechává.
    expect(stat?.cachedAt).not.toBeNull();
  });

  it('writes an audit record for every segment change', async () => {
    const created = await createSegment(ctx, { name: 'S auditem', definition: statusActive });
    const { rows } = await withWorkspace(ctx, (tx) =>
      tx.execute<{ action: string }>(sql`
        SELECT action FROM audit_log
         WHERE target_type = 'segment' AND target_id = ${created.id}::uuid`),
    );
    expect(rows.map((r) => r.action)).toContain('segment.created');
  });
});

// ---------------------------------------------------------------------------
// 6. Rozpad publika a diagnostika prázdného výsledku
// ---------------------------------------------------------------------------

describe('audience breakdown and empty diagnostics', () => {
  let ctx: WorkspaceContext;
  const ast: SegmentAst = {
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
        {
          type: 'condition',
          field: { kind: 'attribute', key: 'city' },
          operator: 'eq',
          value: 'Brno',
        },
      ],
    },
  };

  beforeAll(async () => {
    ctx = await testContext();
    await withWorkspace(ctx, (tx) =>
      tx.execute(sql`
        INSERT INTO contact_fields (workspace_id, key, type)
        VALUES (${ctx.workspaceId}::uuid, 'city', 'text')`),
    );
    await seedContacts(
      ctx,
      Array.from({ length: 10 }, (_, i) => ({
        email: `gate-${i}@example.cz`,
        attributes: { city: 'Praha' },
      })),
    );
  }, 600_000);

  it('names the condition that alone returns zero', async () => {
    const out = await diagnoseEmptyResult(ctx, ast, { asOf, timezone: 'Europe/Prague' });
    expect(out.mostRestrictive?.path).toEqual([1]);
    expect(out.perCondition[0]?.count).toBeGreaterThan(0);
    expect(out.perCondition[1]?.count).toBe(0);
  });

  it('offers the most frequent values of the field that filtered everything out', async () => {
    const out = await diagnoseEmptyResult(ctx, ast, { asOf, timezone: 'Europe/Prague' });
    expect(out.fieldStats?.key).toBe('city');
    expect(out.fieldStats?.filled).toBe(10);
    expect(out.fieldStats?.topValues[0]).toMatchObject({ value: 'Praha', count: 10 });
  });

  it('runs at all, which is the point: one missing column takes the whole breakdown down', async () => {
    // Sedm bran se skládá do JEDNOHO dotazu se sedmi count(*) FILTER, takže
    // jediný neexistující sloupec neshodí jednu bránu, ale celou obrazovku
    // chybou 42703. Test drží tuhle vlastnost tím, že rozpad vůbec spustí.
    const all: SegmentAst = {
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
    };
    const out = await audienceBreakdown(ctx, { ast: all }, { asOf, timezone: 'Europe/Prague' });
    expect(out.input).toBeGreaterThan(0);
    expect(Number.isNaN(out.willSend)).toBe(false);
  });

  it('subtracts gates in the documented order and the numbers add up', async () => {
    const all: SegmentAst = {
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
    };
    const out = await audienceBreakdown(ctx, { ast: all }, { asOf, timezone: 'Europe/Prague' });
    const removed = out.gates.reduce((sum, g) => sum + g.count, 0);
    expect(out.input - removed).toBe(out.willSend);
    expect(out.gates.map((g) => g.key)).toEqual([
      'suppressed',
      'unsubscribed',
      'unconfirmed',
      'snoozed',
      'processing_restricted',
      'duplicate',
      'sample',
    ]);
  });

  it('keeps the inert gates at zero, so nobody reads them as measured', async () => {
    const all: SegmentAst = {
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
    };
    const out = await audienceBreakdown(ctx, { ast: all }, { asOf, timezone: 'Europe/Prague' });
    for (const key of INERT_GATES) {
      expect(out.gates.find((g) => g.key === key)?.count, key).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Obálka drží i proti skutečným datům
// ---------------------------------------------------------------------------

describe('envelope against real rows', () => {
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(ctx, [
      { email: 'ok@example.cz' },
      { email: 'smazany@example.cz' },
      { email: 'omezeny@example.cz' },
      { email: 'blokovany@example.cz' },
      { email: 'anonymizovany@example.cz' },
    ]);
    await withWorkspace(ctx, async (tx) => {
      await tx.execute(sql`
        UPDATE contacts SET deleted_at = now()
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'smazany@example.cz'`);
      await tx.execute(sql`
        UPDATE contacts SET processing_restricted = true
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'omezeny@example.cz'`);
      await tx.execute(sql`
        UPDATE contacts SET anonymized_at = now()
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'anonymizovany@example.cz'`);
      await tx.execute(sql`
        INSERT INTO suppressions (workspace_id, email, fingerprint, fingerprint_key_id, reason, source)
        VALUES (${ctx.workspaceId}::uuid, 'blokovany@example.cz', '\\x00'::bytea, 1, 'manual', 'manual')`);
    });
  }, 600_000);

  it('lets through only the contact that passes all six conditions', async () => {
    const rows = await listSegmentContacts(ctx, statusActive, { limit: 20 }, { asOf });
    expect(rows.rows.map((r) => r.email)).toEqual(['ok@example.cz']);
  });

  it('applies the very same envelope to compileAudienceToSql', async () => {
    const compiled = await compileAudienceToSql(
      ctx,
      { ast: statusActive },
      {
        alias: 'a',
        paramOffset: 0,
        asOf,
        timezone: 'Europe/Prague',
      },
    );
    const { rows } = await runReadOnly(
      ctx,
      (tx) => tx.execute<{ contact_id: string }>(toSql(compiled.sql, compiled.params)),
      { timeoutMs: 20_000 },
    );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Joby
// ---------------------------------------------------------------------------

describe('cleanup after reactivation', () => {
  let ctx: WorkspaceContext;
  let segmentId = '';
  let tagId = '';

  beforeAll(async () => {
    ctx = await testContext();
    await seedContacts(
      ctx,
      Array.from({ length: 4 }, (_, i) => ({ email: `clean-${i}@example.cz` })),
    );
    const created = await createSegment(ctx, { name: 'K úklidu', definition: statusActive });
    const frozen = await freezeSegment(ctx, created.id, { name: 'K úklidu zmrazený' });
    segmentId = frozen.id;
    tagId = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO tags (workspace_id, name) VALUES (${ctx.workspaceId}::uuid, 'ozval se')
        RETURNING id`);
      const id = rows[0]!.id;
      // Jeden kontakt se ozval, ten z úklidu vypadá.
      await tx.execute(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        SELECT id, ${id}::uuid, ${ctx.workspaceId}::uuid FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'clean-0@example.cz'`);
      return id;
    });
  }, 600_000);

  it('skips contacts that carry the reactivation tag', async () => {
    const out = await cleanupHandler({
      data: {
        workspaceId: ctx.workspaceId,
        segmentId,
        action: 'unsubscribe_all',
        reactivatedTagId: tagId,
      },
    });
    expect(out.considered).toBe(4);
    expect(out.skipped).toBe(1);
    expect(out.affected).toBe(3);
  });

  it('is idempotent: a second run affects nothing', async () => {
    const payload = {
      data: {
        workspaceId: ctx.workspaceId,
        segmentId,
        action: 'unsubscribe_all' as const,
        reactivatedTagId: tagId,
      },
    };
    await cleanupHandler(payload);
    const second = await cleanupHandler(payload);
    expect(second.affected).toBe(0);
  });

  it('refuses the delete action for a non owner actor', async () => {
    const caught = await cleanupHandler({
      data: {
        workspaceId: ctx.workspaceId,
        segmentId,
        action: 'delete',
        reactivatedTagId: tagId,
        actorRole: 'admin',
      },
    }).catch((e: unknown) => e);
    expect((caught as { status?: number }).status).toBe(403);
  });
});

describe('scheduleStale across workspaces', () => {
  /**
   * Detektor tiché nuly.
   *
   * Založí zastaralý dynamický segment ve DVOU různých projektech a čeká, že je
   * plánovač najde OBA. Bez systémového bypassu vrátí `withoutContext` nula
   * řádků a nevrátí chybu, takže by se bez tohohle testu porucha nikdy
   * neprojevila: `{ scheduled: 0 }` je naprosto věrohodná hodnota.
   *
   * Test se schválně NEPTÁ strážce `assertCrossWorkspaceVisibility`, protože ten
   * vznikl ze stejné úvahy jako ochrana samotná. Ptá se dat: dva projekty, dva
   * segmenty, očekávám dvě zařazení.
   */
  it('finds stale segments in every workspace, or fails loudly, but never reports a silent zero', async () => {
    const ctxA = await testContext();
    const ctxB = await testContext();
    await seedContacts(ctxA, [{ email: 'stale-a@example.cz' }]);
    await seedContacts(ctxB, [{ email: 'stale-b@example.cz' }]);

    const long = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seeded: string[] = [];
    for (const c of [ctxA, ctxB]) {
      const row = await createSegment(c, {
        name: `Stale ${c.workspaceId.slice(-4)}`,
        definition: statusActive,
      });
      await withWorkspace(c, (tx) =>
        tx.execute(
          sql`UPDATE segments SET cached_at = ${long.toISOString()}::timestamptz WHERE id = ${row.id}::uuid`,
        ),
      );
      seeded.push(row.id);
    }

    const scheduled: string[] = [];
    const outcome = await scheduleStale(async (p) => {
      scheduled.push(p.segmentId);
    }).then(
      (n) => ({ ok: true as const, n }),
      (e: unknown) => ({ ok: false as const, e }),
    );

    // Buď plánovač napříč projekty vidí, nebo hlasitě spadne. Třetí možnost,
    // tedy úspěch s nulou, je jediný stav, ve kterém se porucha nikdy neprojeví.
    if (!outcome.ok) {
      expect(segmentErrorCode(outcome.e)).toBe('cross_workspace_scan_blocked');
    } else {
      expect(outcome.n).toBeGreaterThanOrEqual(2);
      for (const id of seeded) expect(scheduled).toContain(id);
    }
  }, 600_000);
});
