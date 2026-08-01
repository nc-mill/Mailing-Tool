import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
// withUser doplněno oproti plánu: plán ho v testu „výpis pod mlain.user_id"
// používá, ale zapomněl ho naimportovat.
import { appPool, closePools, pgErrorCode, withUser, withoutContext, withWorkspace } from '../tx';
import { createWorkspaceContext } from './context';
import { hashPassword } from './password';

let harness: PgHarness;
let userId = '';
let strangerId = '';
let wsA = '';
let wsB = '';
let wsStranger = '';
let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;
let endpointInA = '';

/**
 * Porušení RLS se pozná podle SQLSTATE, ne podle textu hlášky.
 *
 * ODCHYLKA OD PLÁNU, a je to ta nejdůležitější v celém souboru. Plán psal
 * `rejects.toThrow(/row-level security|new row violates/i)`. Takový test
 * NEPROJDE ANI KDYŽ RLS FUNGUJE: `toThrow` porovnává `error.message`, jenže
 * Drizzle chybu ovladače zabalí do `DrizzleQueryError`, jehož zpráva zní
 * „Failed query: insert into ...". Skutečná hláška z Postgresu leží až na
 * `error.cause.message`. Je to přesně ta past, kterou plán sám popisuje
 * v kapitolách 0.6 a 0.8, a pak do ní ve vlastním testu spadl.
 *
 * Naměřeno spuštěním proti PostgreSQL 18 pod rolí `mlain_app`:
 *   pgErrorCode(e)      = '42501'
 *   e.cause.message     = 'new row violates row-level security policy for table "webhook_endpoints"'
 *
 * Kontrola přes SQLSTATE je navíc silnější: text hlášky se může lišit podle
 * jazyka serveru, kód 42501 ne.
 */
async function expectRlsViolation(operation: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'operace měla selhat na row-level security, ale prošla').toBeDefined();
  expect(pgErrorCode(caught)).toBe('42501');
  expect(String((caught as { cause?: { message?: string } }).cause?.message)).toMatch(
    /row-level security|new row violates/i,
  );
}

beforeAll(async () => {
  // Kontejner si zakládá test sám, viz komentář v pg-harness.ts. Aplikační
  // spojení jde pod `mlain_app`, tedy pod rolí, na kterou RLS dopadá; pod
  // vlastníkem schématu by celý tenhle soubor byl falešně zelený a test
  // „test běží pod rolí mlain_app" je tu proto, aby to nešlo přehlédnout.
  harness = await startPgHarness();

  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: `iso-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  // Projekt zakládá createWorkspaceAsUser z @mlain/db, ne ruční INSERT.
  // Je to jediná funkce, která umí správné pořadí (ID dopředu, kontext před
  // vložením); ruční INSERT ... RETURNING na workspaces bez kontextu skončí
  // na "new row violates row-level security policy" a vložení členství
  // neprojde přes WITH CHECK politiky ws_isolation.
  const a = await createWorkspaceAsUser(appPool(), userId, {
    name: 'A',
    slug: `iso-a-${Date.now()}`,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  const b = await createWorkspaceAsUser(appPool(), userId, {
    name: 'B',
    slug: `iso-b-${Date.now()}`,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  wsA = a.id;
  wsB = b.id;

  // Cizí uživatel a jeho projekt. Bez něj by se izolace projektů nedala odlišit
  // od pouhého členství: `userId` je členem A i B, takže na jeho vlastních
  // projektech nejde ukázat, že cizí projekt vidět NENÍ.
  strangerId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: `cizi-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });
  const stranger = await createWorkspaceAsUser(appPool(), strangerId, {
    name: 'Cizi',
    slug: `iso-c-${Date.now()}`,
    locale: 'cs',
    timezone: 'Europe/Prague',
  });
  wsStranger = stranger.id;

  // Kontext se vyrábí SKUTEČNOU továrnou, ne unsafeWorkspaceContext. Test tím
  // zároveň pokrývá cestu, kterou jde produkční kód.
  ctxA = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsA });
  ctxB = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsB });

  endpointInA = await withWorkspace(ctxA, async (tx) => {
    const [e] = await tx
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId: wsA,
        url: 'https://example.com/hook',
        eventTypes: ['contact.created'],
        secretEncrypted: 'enc:v1:placeholder',
      })
      .returning({ id: schema.webhookEndpoints.id });
    return e!.id;
  });
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('kritérium 20: bez kontextu nevidí aplikační role nic', () => {
  it('SELECT bez set_config vrátí 0 řádků', async () => {
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM webhook_endpoints`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('test běží pod rolí mlain_app, ne pod vlastníkem schématu', async () => {
    const role = await withoutContext(async (tx) => {
      const result = await tx.execute<{ role: string }>(sql`SELECT current_user AS role`);
      return result.rows[0]!.role;
    });
    expect(role).toBe('mlain_app');
  });
});

describe('kritérium 21: cizí workspace_id neprojde WITH CHECK', () => {
  it('INSERT s cizím workspace_id pod kontextem B selže', async () => {
    await expectRlsViolation(
      withWorkspace(ctxB, async (tx) => {
        await tx.insert(schema.webhookEndpoints).values({
          workspaceId: wsA,
          url: 'https://example.com/podvrh',
          eventTypes: ['contact.created'],
          secretEncrypted: 'enc:v1:placeholder',
        });
      }),
    );
  });

  it('SELECT řádku z A pod kontextem B vrátí 0 řádků', async () => {
    const rows = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute(
        sql`SELECT id FROM webhook_endpoints WHERE id = ${endpointInA}::uuid`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('UPDATE řádku z A pod kontextem B ovlivní 0 řádků', async () => {
    const updated = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute(
        sql`UPDATE webhook_endpoints SET description = 'zmena' WHERE id = ${endpointInA}::uuid RETURNING id`,
      );
      return result.rows;
    });
    expect(updated).toHaveLength(0);
  });

  it('pod kontextem A je řádek vidět, tedy test neměří jen prázdnou tabulku', async () => {
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute(
        sql`SELECT id FROM webhook_endpoints WHERE id = ${endpointInA}::uuid`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('kritérium 21d: workspaces je předmětem i nositelem izolace', () => {
  it('SELECT workspaces pod kontextem B vrátí právě jeden řádek, a to B', async () => {
    const ids = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM workspaces`);
      return result.rows.map((r) => r.id);
    });

    // Kritérium 21d doslova. Platí až od opravy politiky `ws_member_visibility`
    // v migraci 0004: ta je FOR SELECT a PERMISSIVE, takže se OR-ovala
    // s `ws_isolation_self`, a protože `withWorkspace` u aktéra typu `user`
    // nastavuje oba GUC naráz, propouštěla pod workspace kontextem i ostatní
    // projekty téhož uživatele (naměřeny dva řádky místo jednoho). Strážce
    // `NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL`
    // ji nechá platit jen tam, kam patří, tedy na výpis projektů bez kontextu.
    expect(ids).toEqual([wsB]);

    // A hlavně: projekt cizího uživatele není vidět tak jako tak. Tady izolace
    // projektů skutečně stojí, zbytek je otázka tvaru výpisu.
    expect(ids).not.toContain(wsStranger);
    expect(ids).not.toContain(wsA);
  });

  it('výpis pod mlain.user_id vrátí jen projekty s členstvím', async () => {
    const rows = await withUser(userId, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM workspaces`);
      return result.rows;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(wsA);
    expect(ids).toContain(wsB);
  });

  it('bez mlain.user_id i bez workspace kontextu vrátí 0 řádků', async () => {
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM workspaces`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('založení projektu bez mlain.user_id selže na WITH CHECK', async () => {
    await expectRlsViolation(
      withoutContext(async (tx) => {
        await tx.insert(schema.workspaces).values({
          name: 'Bez kontextu',
          slug: `no-ctx-${Date.now()}`,
          locale: 'cs',
          timezone: 'Europe/Prague',
        });
      }),
    );
  });
});
