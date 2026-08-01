// packages/db/test/isolation.test.ts
//
// Kritéria 20, 21, 21c a 21d části 1. Běží proti reálnému PostgreSQL,
// ne proti mocku, protože dokazuje, že RLS není jen deklarovaná, ale opravdu
// blokuje. Všechny dotazy jdou pod mlain_app, nikdy pod migrátorem.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { unsafeWorkspaceContext } from '../src/unsafe-context';
import { withWorkspace } from '../src/repo/tx';
import { registeredRepoModules } from '../src/repo/registry';
import { ensurePartitionsForRange } from '../src/partitions';
import { expectRlsViolation } from './helpers/errors';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // Šablona se migruje s ensurePartitions: false. Oddíly kolem dneška si
  // zakládá test sám: rozsah je schválně širší než jeden měsíc, jinak by
  // test prořezávání porovnával jedničku s jedničkou a neprokázal nic.
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 1));
  await ensurePartitionsForRange(h.as('mlain_migrator'), 'web_events', 'received_at', from, to);
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('izolace projektů', () => {
  it('surové SQL bez set_config vrátí 0 řádků (kritérium 20)', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const { rows } = await h.as('mlain_app').query('SELECT * FROM contacts');
    expect(rows).toHaveLength(0);
  });

  it('čtení kontaktu z A pod kontextem B vrátí 0 řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM contacts WHERE id = ${ws.contactInA}`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('update kontaktu z A pod kontextem B ovlivní 0 řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const affected = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(
        sql`UPDATE contacts SET first_name = 'ukradeno' WHERE id = ${ws.contactInA}`,
      );
      return r.rowCount;
    });
    expect(affected).toBe(0);
  });

  it('insert s cizím workspace_id selže na WITH CHECK (kritérium 21)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const failure = await expectRlsViolation(
      () =>
        withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
          await tx.execute(sql`INSERT INTO contacts (workspace_id, email, locale)
         VALUES (${ws.workspaceA}, 'pruniku@example.test', 'cs')`);
        }),
      'zápis pod cizím workspace_id prošel:',
    );
    expect(failure.message).toMatch(/contacts/);
  });

  it('insert s vlastním workspace_id pod svým kontextem projde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const inserted = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute<{
        id: string;
      }>(sql`INSERT INTO contacts (workspace_id, email, locale)
         VALUES (${ws.workspaceB}, 'vlastni@example.test', 'cs') RETURNING id`);
      return r.rows[0]!.id;
    });
    expect(inserted).toBeTruthy();
  });

  it('SELECT workspaces pod kontextem B vrátí právě jeden řádek, a to B (kritérium 21d)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`SELECT id FROM workspaces`);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(ws.workspaceB);
  });

  it('výpis projektů bez mlain.user_id i bez workspace kontextu vrátí 0 řádků', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const { rows } = await h.as('mlain_app').query('SELECT id FROM workspaces');
    expect(rows).toHaveLength(0);
  });

  it('izolace platí i na partitionovaných tabulkách', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO web_events (id, workspace_id, name, occurred_at, contact_id)
       VALUES (gen_random_uuid(), $1, 'page_view', now(), $2)`,
      [ws.workspaceA, ws.contactInA],
    );
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM web_events`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('RLS neruší prořezávání partition u web_events', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const plan = await withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      const r = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN SELECT * FROM web_events
          WHERE received_at >= now() - interval '1 day' AND received_at < now()`);
      return r.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    // UNIKÁTNÍ názvy, ne počet výskytů řetězce. Název oddílu se v plánu
    // objeví vícekrát (uzel skenu i název indexu), takže počítání výskytů
    // hlásí čtyři i tehdy, když prořezávání odstranilo sedm oddílů z devíti,
    // tedy pracovalo bezvadně. Na přelomu měsíce by test spadl vždy.
    const scanned = new Set(plan.match(/web_events_y\d{4}m\d{2}/g) ?? []).size;
    expect(scanned, `plán sahá na ${scanned} oddílů:\n${plan}`).toBeLessThanOrEqual(2);
  });

  it('generický test napříč doménami: každý zaregistrovaný reader vrací pod cizím kontextem prázdno', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    for (const module of registeredRepoModules()) {
      for (const reader of module.readers) {
        // Transakci otevírá TEST, ne registrovaná funkce (rozhodnutí R38).
        // Jen tak jde cizí kontext vnutit zvenčí; kdyby si ji otevírala
        // funkce sama, kontrolovala by se sama sebou.
        const result = await withWorkspace(h.as('mlain_app'), ctxB, (tx) => reader.call(tx, ctxB));
        const empty =
          result === null || result === undefined || (Array.isArray(result) && result.length === 0);
        expect(empty, `${module.name}.${reader.name} vrátil pod cizím kontextem data`).toBe(true);
      }
    }
  });
});
