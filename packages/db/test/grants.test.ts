// packages/db/test/grants.test.ts
//
// Každý test tady se ptá KATALOGU (pg_roles, pg_class.relacl, aclexplode,
// pg_policies), ne seznamu v kódu, ze kterého ochrana vznikla. Kdyby se ptal
// registru, chyběla by politika sender_bypass na campaign_render_warnings dál
// a test by byl zelený.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { MAINTENANCE_BYPASS_TABLES, SENDER_BYPASS_TABLES } from '../src/rls';
import { ROLES } from './global-setup';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { unsafeWorkspaceContext } from '../src/unsafe-context';
import { withWorkspace } from '../src/repo/tx';
import { createMonthlyPartitions } from '../src/partitions';
import { expectPermissionDenied } from './helpers/errors';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => {
  await h.stop();
});

/** Skutečné granty z katalogu, ne z registru. */
async function grantsOf(role: string): Promise<Map<string, Set<string>>> {
  const { rows } = await h.as('mlain_migrator').query<{ relname: string; privilege_type: string }>(
    `SELECT c.relname, a.privilege_type
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'public' AND a.grantee = $1::regrole`,
    [role],
  );
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!out.has(row.relname)) out.set(row.relname, new Set());
    out.get(row.relname)!.add(row.privilege_type);
  }
  // Sloupcové granty se v relacl neobjeví, tabulka se jimi ale stává
  // pro roli přístupnou, takže se musí započítat taky.
  const columns = await h.as('mlain_migrator').query<{ relname: string; privilege_type: string }>(
    `SELECT c.relname, a.privilege_type
       FROM pg_attribute att
       JOIN pg_class c ON c.oid = att.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(att.attacl) a
      WHERE n.nspname = 'public' AND att.attacl IS NOT NULL
        AND a.grantee = $1::regrole`,
    [role],
  );
  for (const row of columns.rows) {
    if (!out.has(row.relname)) out.set(row.relname, new Set());
    out.get(row.relname)!.add(row.privilege_type);
  }
  return out;
}

describe('role a jejich atributy', () => {
  it('všech šest rolí v databázi existuje', async () => {
    // Testovací harness si role zakládá sám, takže tenhle test NEDOKAZUJE,
    // že je založí produkce. Dokazuje, že jich je právě šest a že se seznam
    // v kódu nerozešel se skutečností. Že je zakládá i produkce, je požadavek
    // na P01 v kapitole 7 a hlídá ho `mlain doctor` (P16).
    const { rows } = await h
      .as('mlain_migrator')
      .query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname LIKE 'mlain\\_%' ORDER BY 1`,
      );
    expect(rows.map((r) => r.rolname)).toEqual([...ROLES].sort());
  });

  it('žádná aplikační role nemá BYPASSRLS ani superuživatele', async () => {
    // Kdyby P01 založil mlain_app s BYPASSRLS, izolace projektů by zmizela
    // a VŠECHNY ostatní testy by zůstaly zelené, protože RLS by se prostě
    // neuplatnila. Tohle je jediné místo, které to zachytí.
    const { rows } = await h.as('mlain_migrator').query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
          FROM pg_roles WHERE rolname LIKE 'mlain\\_%'`);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.rolsuper, `${row.rolname} je superuživatel`).toBe(false);
      expect(row.rolbypassrls, `${row.rolname} má BYPASSRLS`).toBe(false);
      expect(row.rolcreatedb, `${row.rolname} má CREATEDB`).toBe(false);
      expect(row.rolcreaterole, `${row.rolname} má CREATEROLE`).toBe(false);
    }
  });

  it('mlain_app nesmí zakládat tabulky (rozhodnutí R30)', async () => {
    // Oddíly zakládá výhradně migrátor. Kdyby je uměla založit aplikace,
    // vznikaly by mimo migrační cestu a bez kontroly.
    await expectPermissionDenied(
      () => h.as('mlain_app').query('CREATE TABLE pokus_o_tabulku (id int)'),
      'mlain_app založil tabulku:',
    );
  });
});

describe('granty proti politikám, obojí z katalogu', () => {
  it('každá tabulka s grantem pro mlain_sender má politiku sender_bypass', async () => {
    // Tohle je K3 z bezpečnostní revize. Původní test iteroval seznam
    // SENDER_BYPASS_TABLES, tedy TÝŽ zdroj, ze kterého politiky vznikly,
    // takže tabulku s grantem a bez politiky nemohl najít z principu.
    const granted = await grantsOf('mlain_sender');
    const { rows } = await h.as('mlain_migrator').query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'sender_bypass'`,
    );
    const withPolicy = new Set(rows.map((r) => r.tablename));

    for (const table of granted.keys()) {
      expect(
        withPolicy.has(table),
        `sender má grant na ${table}, ale chybí politika sender_bypass, ` +
          `takže dotaz vrátí nula řádků nebo zápis selže na RLS`,
      ).toBe(true);
    }
    // A opačně: politika bez grantu je mrtvý kód, který svádí k tomu,
    // považovat tabulku za dostupnou.
    for (const table of withPolicy) {
      expect(
        granted.has(table),
        `${table} má politiku sender_bypass, ale sender na ni nemá grant`,
      ).toBe(true);
    }
    // Registr v kódu musí popisovat totéž. Když se rozejde, je špatně registr,
    // ne katalog.
    expect([...withPolicy].sort()).toEqual([...SENDER_BYPASS_TABLES].sort());
  });

  it('každá tabulka s grantem pro mlain_maintenance má politiku maintenance_bypass', async () => {
    const granted = await grantsOf('mlain_maintenance');
    const { rows } = await h.as('mlain_migrator').query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'maintenance_bypass'`,
    );
    const withPolicy = new Set(rows.map((r) => r.tablename));
    for (const table of granted.keys()) {
      expect(
        withPolicy.has(table),
        `mlain_maintenance má grant na ${table} bez politiky, takže DELETE ` +
          `ovlivní nula řádků a NEVRÁTÍ CHYBU`,
      ).toBe(true);
    }
    expect([...withPolicy].sort()).toEqual([...MAINTENANCE_BYPASS_TABLES].sort());
  });

  it('mlain_gdpr má na consents SELECT i DELETE, ne jen DELETE', async () => {
    // Se samotným DELETE skončí `DELETE FROM consents WHERE contact_id = $1`
    // na permission denied, protože čte sloupec v podmínce. Test, který mazal
    // bez WHERE, to maskoval tvarem, jaký job nikdy nepoužije.
    const granted = await grantsOf('mlain_gdpr');
    expect([...(granted.get('consents') ?? [])].sort()).toEqual(['DELETE', 'SELECT']);
    expect([...granted.keys()], 'mlain_gdpr má práva mimo consents').toEqual(['consents']);
  });

  it('sender nemá grant na žádnou tabulku mimo registr', async () => {
    const granted = await grantsOf('mlain_sender');
    expect([...granted.keys()].sort()).toEqual([...SENDER_BYPASS_TABLES].sort());
  });
});

describe('oddíly nejsou přímo přístupné (rozhodnutí R20)', () => {
  it('žádný oddíl nemá tabulkový ani sloupcový ACL záznam', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relispartition
          AND (c.relacl IS NOT NULL
               OR EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL))
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('přímý SELECT z oddílu web_events nevrátí cizí projekt, ale chybu', async () => {
    // Naměřený scénář z revize: přes rodiče vrátí dotaz jeden řádek,
    // přímo na oddíl dva, tedy včetně cizího projektu. S rozhodnutím R20
    // druhá cesta neexistuje.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await createMonthlyPartitions(
      h.as('mlain_migrator'),
      'web_events',
      'received_at',
      new Date(),
      1,
    );
    const { rows: part } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'web_events'::regclass LIMIT 1`,
    );
    const partition = part[0]!.relname;

    for (const workspace of [ws.workspaceA, ws.workspaceB]) {
      await h.as('mlain_migrator').query(
        // anonymous_id je proti plánu navíc: ck_web_events__subject vyžaduje
        // aspoň jeden ze tří subjektů, jinak zápis skončí chybou 23514
        // a test by nezkoumal oprávnění, ale vlastní fixture.
        `INSERT INTO web_events (id, workspace_id, name, occurred_at, anonymous_id)
         VALUES (gen_random_uuid(), $1, 'page_view', now(), gen_random_uuid())`,
        [workspace],
      );
    }

    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const viaParent = await withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM web_events`);
      return r.rows[0]!.n;
    });
    expect(viaParent).toBe(1);

    await expectPermissionDenied(
      () => h.as('mlain_app').query(`SELECT count(*) FROM ${partition}`),
      'přímý přístup na oddíl obchází RLS:',
    );
  });

  it('DELETE přímo z oddílu audit_log neprojde', async () => {
    // Naměřeno v revizi: DELETE FROM audit_log skončil permission denied,
    // ale DELETE FROM audit_log_y2026m08 smazal VŠECHNO včetně cizích
    // a globálních auditních záznamů.
    await createMonthlyPartitions(h.as('mlain_migrator'), 'audit_log', 'created_at', new Date(), 1);
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'audit_log'::regclass LIMIT 1`,
    );
    await expectPermissionDenied(
      () => h.as('mlain_app').query(`DELETE FROM ${rows[0]!.relname}`),
      'aplikace smazala řádky přímo z oddílu audit_log:',
    );
  });
});

describe('mlain_apply_grants() je idempotentní a obnovitelná', () => {
  /** Otisk všech oprávnění, ze kterého jde porovnat "před" a "po". */
  async function aclSnapshot(): Promise<string> {
    const { rows } = await h.as('mlain_migrator').query<{ acl: string }>(
      `SELECT c.relname || ' ' || COALESCE(c.relacl::text, '-') AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        ORDER BY c.relname`,
    );
    return rows.map((r) => r.acl).join('\n');
  }

  it('druhé zavolání nezmění ani jedno oprávnění', async () => {
    const before = await aclSnapshot();
    await h.as('mlain_migrator').query('SELECT mlain_apply_grants()');
    expect(await aclSnapshot()).toBe(before);
  });

  it('po ztrátě grantů je funkce obnoví do stejného stavu', async () => {
    // Přesně to, co se stane po obnově z pg_dump --no-privileges: politiky
    // v dumpu jsou, granty ne, a ledger migrací tvrdí, že migrace s granty
    // proběhla. Bez téhle funkce by aplikace skončila na permission denied.
    const before = await aclSnapshot();
    await h.as('mlain_migrator').query(`
      DO $$ DECLARE t text; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                    AND c.relispartition = false
        LOOP
          EXECUTE format('REVOKE ALL ON %I FROM mlain_app, mlain_sender, '
                         'mlain_gdpr, mlain_maintenance', t);
        END LOOP;
      END $$`);
    expect(await aclSnapshot()).not.toBe(before);

    await h.as('mlain_migrator').query('SELECT mlain_apply_grants()');
    expect(await aclSnapshot()).toBe(before);
  });

  it('funkci nesmí zavolat aplikační role', async () => {
    await expectPermissionDenied(
      () => h.as('mlain_app').query('SELECT mlain_apply_grants()'),
      'aplikace zavolala mlain_apply_grants():',
    );
  });
});
