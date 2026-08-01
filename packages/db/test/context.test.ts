// packages/db/test/context.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import { unsafeWorkspaceContext } from '../src/unsafe-context';
import { pgErrorCode, withReadOnly, withUser, withWorkspace, withoutContext } from '../src/repo/tx';
import { checkIsolationPrerequisites } from '../src/client';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 180_000);
afterAll(async () => {
  await h.stop();
});

describe('transakční obálka', () => {
  it('nastaví mlain.workspace_id na dobu transakce a po ní ho zapomene', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });

    const inside = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute<{ ws: string | null }>(
        sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
      );
      return rows[0].ws;
    });
    expect(inside).toBe(ws.workspaceA);

    // Čte se přes NULLIF, protože pool vrátí TOTÉŽ spojení a holá varianta
    // na něm po commitu vrací prázdný řetězec, ne NULL (R21, ověřeno spuštěním).
    // Právě proto smí kontext číst jenom NULLIF, a to i tady v testu.
    const { rows } = await h
      .as('mlain_app')
      .query<{ ws: string | null }>(
        `SELECT NULLIF(current_setting('mlain.workspace_id', true), '') AS ws`,
      );
    expect(rows[0].ws).toBeNull();
  });

  it('u aktéra typu user nastaví i mlain.user_id', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, {
      type: 'user',
      userId: ws.userId,
      role: 'owner',
    });
    const seen = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute<{ u: string | null }>(
        sql`SELECT current_setting('mlain.user_id', true) AS u`,
      );
      return rows[0].u;
    });
    expect(seen).toBe(ws.userId);
  });

  it('výjimka uvnitř transakci rollbackne', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(
      withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
        await tx.execute(
          sql`INSERT INTO tags (workspace_id, name) VALUES (${ws.workspaceA}, 'rollback-me')`,
        );
        throw new Error('bum');
      }),
    ).rejects.toThrow('bum');

    const after = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tags`);
      return rows[0].n;
    });
    expect(after).toBe(0);
  });

  it('withUser nastaví mlain.user_id a NEnastaví mlain.workspace_id', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const seen = await withUser(h.as('mlain_app'), ws.userId, async (tx) => {
      const { rows } = await tx.execute<{ u: string | null; w: string | null }>(
        sql`SELECT current_setting('mlain.user_id', true) AS u,
                NULLIF(current_setting('mlain.workspace_id', true), '') AS w`,
      );
      return rows[0];
    });
    expect(seen.u).toBe(ws.userId);
    expect(seen.w).toBeNull();
  });

  it('druhý dotaz ze stejného spojení bez kontextu vrátí prázdno, ne chybu 22P02', async () => {
    // Po SET LOCAL vrací current_setting(..., true) na TOMTÉŽ spojení
    // po commitu prázdný řetězec, ne NULL. Politika s holým
    // current_setting(...)::uuid by tedy skončila chybou
    // "invalid input syntax for type uuid" místo prázdného výsledku,
    // a to až v provozu, kde se spojení recyklují. Proto NULLIF (R21).
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const pool = h.as('mlain_app');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ws.workspaceA]);
      await client.query('COMMIT');
      // Prázdný řetězec, ne NULL. Tohle je ten stav.
      const { rows: leaked } = await client.query<{ w: string | null }>(
        `SELECT current_setting('mlain.workspace_id', true) AS w`,
      );
      expect(leaked[0].w).toBe('');
      // A přesto musí dotaz vrátit nula řádků, ne spadnout.
      const { rows } = await client.query('SELECT * FROM contacts');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
    // Kontext se pak dá nastavit znovu a funguje.
    const seen = await withWorkspace(pool, ctx, async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM contacts`);
      return r.rows[0].n;
    });
    expect(seen).toBe(1);
  });

  it('bootstrap politika nepustí založení projektu na spojení po přihlášeném uživateli', async () => {
    // Prázdný řetězec je IS NOT NULL, takže holá podmínka by pustila INSERT
    // bez jakéhokoli aktéra na každém spojení, které kdy obsloužilo přihlášení.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const client = await h.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [ws.userId]);
      await client.query('COMMIT');
      await expect(
        client.query(
          `INSERT INTO workspaces (name, slug, locale, timezone)
           VALUES ('podvrh', 'podvrh-ws', 'cs', 'Europe/Prague')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      client.release();
    }
  });

  it('přenastavení kontextu uvnitř read-only transakce shodí celou operaci', async () => {
    // BEGIN READ ONLY nezakazuje SET LOCAL. Náhled segmentu spouští dynamicky
    // sestavené SQL, takže injekce v něm by si mohla přepnout kontext
    // na cizí projekt a přečíst cizí kontakty. Obálka to musí poznat
    // a výsledek NEVYDAT.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    await expect(
      withReadOnly(h.as('mlain_app'), ctxB, { statementTimeoutMs: 3000 }, async (tx) => {
        await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${ws.workspaceA}, true)`);
        const r = await tx.execute(sql`SELECT * FROM contacts`);
        return r.rows;
      }),
    ).rejects.toThrow(/kontext/i);
  });

  it('checkIsolationPrerequisites pozná roli, na kterou se RLS nevztahuje', async () => {
    // Bez téhle kontroly dostane samohostitel s jedinou databázovou rolí
    // funkční aplikaci BEZ IZOLACE PROJEKTŮ a nedozví se to.
    expect(await checkIsolationPrerequisites(h.as('mlain_app'))).toEqual([]);

    const migratorReasons = await checkIsolationPrerequisites(h.as('mlain_migrator'));
    expect(migratorReasons.join(' ')).toMatch(/vlastní schéma public/);
  });

  it('spojení se do poolu nevrací s cizím kontextem ani po chybě', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(
      withWorkspace(h.as('mlain_app'), ctx, async () => {
        throw new Error('bum');
      }),
    ).rejects.toThrow('bum');

    // Pool má max 4 spojení, takže projdeme všechna: kdyby se některé vrátilo
    // s nastaveným kontextem, další nájemce by viděl cizí data.
    for (let i = 0; i < 4; i += 1) {
      const client = await h.as('mlain_app').connect();
      try {
        const { rows } = await client.query<{ w: string | null }>(
          `SELECT NULLIF(current_setting('mlain.workspace_id', true), '') AS w`,
        );
        expect(rows[0].w).toBeNull();
      } finally {
        client.release();
      }
    }
  });
});

describe('tvar transakčního handle', () => {
  // Kdyby Tx zůstal PoolClient, projde tenhle test až ve chvíli, kdy se
  // datová vrstva NEZKOMPILUJE. Proto se ptá za běhu, ne typem.
  it('Tx je Drizzle handle, ne syrový PoolClient', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      for (const method of ['select', 'insert', 'update', 'delete', 'execute']) {
        expect(
          typeof (tx as unknown as Record<string, unknown>)[method],
          `Tx nemá ${method}, což znamená, že to není Drizzle handle`,
        ).toBe('function');
      }
    });
  });

  // Tenhle vzor P04 našel na 41 místech u sebe. Projde typovou kontrolou
  // i revizí a za běhu vrátí undefined při prvním rows[0].
  it('tx.execute vrací obálku výsledku, ne pole řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const result = await tx.execute(sql`SELECT 1 AS x`);
      expect(
        Array.isArray(result),
        'kdyby to bylo pole, byl by vzor `as unknown as Row[]` v pořádku',
      ).toBe(false);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(
        (result as unknown as unknown[])[0],
        'takhle se ta vada projeví: index na obálce je undefined',
      ).toBeUndefined();
    });
  });

  it('pgErrorCode najde kód z Drizzle chyby i ze syrové chyby pg', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });

    // (a) přes Drizzle: kód je na cause, error.code je undefined
    let viaDrizzle: unknown;
    try {
      await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
        await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                             VALUES (${ws.workspaceA}, 'dup')`);
        await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                             VALUES (${ws.workspaceA}, 'dup')`);
      });
    } catch (error) {
      viaDrizzle = error;
    }
    expect(
      (viaDrizzle as { code?: unknown }).code,
      'kdyby tu byl kód, byl by vzor error.code správný',
    ).toBeUndefined();
    expect(pgErrorCode(viaDrizzle)).toBe('23505');

    // (b) přes syrový pool: kód je přímo na error.code a cause není
    let viaRaw: unknown;
    try {
      await h.as('mlain_migrator').query(
        `INSERT INTO workspaces (id, name, slug, locale, timezone)
         VALUES ($1, 'dup', 'dup-slug', 'cs', 'Europe/Prague'),
                ($1, 'dup', 'dup-slug2', 'cs', 'Europe/Prague')`,
        [ws.workspaceA],
      );
    } catch (error) {
      viaRaw = error;
    }
    expect(pgErrorCode(viaRaw)).toBe('23505');
  });
});

describe('withoutContext', () => {
  it('na tabulce s RLS nevrátí nic, na platformové tabulce funguje', async () => {
    // Není to zadní vrátka. Kontext se nenastaví, takže RLS nepustí ani řádek;
    // použitelná je výhradně nad tabulkami z TABLES_WITHOUT_RLS.
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const seen = await withoutContext(h.as('mlain_app'), async (tx) => {
      const chranene = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM contacts`,
      );
      await tx.execute(sql`INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
        VALUES ('user:u1:login', date_trunc('minute', now()), 1, now() + interval '1 minute')
        ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1`);
      const limity = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM rate_limits`,
      );
      return { chranene: chranene.rows[0].n, limity: limity.rows[0].n };
    });
    expect(seen.chranene, 'bez kontextu nesmí RLS pustit ani řádek').toBe(0);
    expect(seen.limity, 'rate_limits RLS nemá, takže limiter funguje').toBe(1);
  });

  it('zápis do tabulky s RLS bez kontextu skončí chybou, ne tichým nic', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const error = await withoutContext(h.as('mlain_app'), async (tx) => {
      await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                           VALUES (${ws.workspaceA}, 'bez-kontextu')`);
    }).catch((e: unknown) => e);

    // Chyba z Drizzle je DrizzleQueryError a jeho `message` je jen
    // „Failed query: INSERT ...". Text z databáze leží na `cause.message`,
    // takže `toThrow(/row-level security/i)` by se NIKDY neshodlo a test by
    // procházel i nad tabulkou, kterou RLS nechrání. Je to tatáž past jako
    // u kódu chyby (R35), jen o úroveň vedle: ptáme se proto na kód přes
    // pgErrorCode a na hlášku až na cause. Ověřeno spuštěním.
    expect(pgErrorCode(error), 'RLS porušení má SQLSTATE 42501').toBe('42501');
    expect((error as { cause?: { message?: string } }).cause?.message ?? '').toMatch(
      /row-level security/i,
    );
  });
});

describe('withReadOnly a SET LOCAL', () => {
  it('pustí dovnitř work_mem i statement_timeout a po commitu je vrátí', async () => {
    // Požadavek P11 (3.6). Bez work_mem se řazení nad velkým publikem přelije
    // na disk a tvrdý strop doby běhu vyprší dřív, než náhled segmentu doběhne.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const uvnitr = await withReadOnly(
      h.as('mlain_app'),
      ctx,
      { statementTimeoutMs: 3000, workMem: '64MB' },
      async (tx) => {
        const { rows } = await tx.execute<{ wm: string; st: string; ro: string }>(
          sql`SELECT current_setting('work_mem') AS wm,
                     current_setting('statement_timeout') AS st,
                     current_setting('transaction_read_only') AS ro`,
        );
        return rows[0];
      },
    );
    expect([uvnitr.wm, uvnitr.st, uvnitr.ro]).toEqual(['64MB', '3s', 'on']);

    // Po transakci se hodnota vrací; SET LOCAL ji na spojení nenechá.
    const { rows } = await h
      .as('mlain_app')
      .query<{ wm: string }>(`SELECT current_setting('work_mem') AS wm`);
    expect(rows[0].wm).not.toBe('64MB');
  });

  it('work_mem mimo povolený tvar se odmítne dřív, než se sáhne na databázi', async () => {
    // SET LOCAL NEJDE parametrizovat, hodnota se do příkazu vkládá textem.
    // Bez téhle kontroly je to přímá cesta k injekci pod aplikační rolí.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(
      withReadOnly(
        h.as('mlain_app'),
        ctx,
        { statementTimeoutMs: 3000, workMem: "64MB'; DROP TABLE contacts; --" },
        async () => 'nemělo doběhnout',
      ),
    ).rejects.toThrow(/work_mem/);

    // A tabulka pořád existuje.
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name = 'contacts'`,
    );
    expect(rows[0].n).toBe(1);
  });
});
