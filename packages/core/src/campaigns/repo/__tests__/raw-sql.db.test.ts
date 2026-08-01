/**
 * Test je databázový, ne jednotkový, a je to schválně. Otázka „nese tenhle dotaz
 * parametry jako parametry?" se nedá zodpovědět z typů, jen spuštěním proti Postgresu.
 *
 * ODCHYLKA OD PLÁNU: kontext si test nevyrábí sám z pevného UUID přes
 * `unsafeWorkspaceContext`. Projekt v databázi musí existovat, jinak RLS na každém
 * dotazu vrátí nula řádků, a založit ho umí harness. Bootstrap kontejneru je tam taky.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { pgErrorCode, withWorkspace } from '../../../tx';
import { withTestWorkspace, type TestWorkspace } from '../../test/harness';
import { rawSql } from '../raw-sql';

describe('rawSql: normativni SQL s pozicovymi parametry', () => {
  let ctx: TestWorkspace;
  beforeAll(async () => {
    ctx = await withTestWorkspace();
  });

  it('vysledek je obalka s rows, ne pole', async () => {
    await withWorkspace(ctx.workspace, async (tx) => {
      const r = await tx.execute<{ n: number }>(rawSql(`SELECT 1::int AS n`, []));
      // Kdo pretypuje vysledek na pole, dostane u [0] undefined a nic nespadne.
      expect(Array.isArray(r)).toBe(false);
      expect(r.rows[0]!.n).toBe(1);
    });
  });

  it('tyz parametr pouzity dvakrat se dosadi dvakrat', async () => {
    await withWorkspace(ctx.workspace, async (tx) => {
      const r = await tx.execute<{ a: number; b: number }>(
        rawSql(`SELECT $1::int AS a, $1::int + $2::int AS b`, [40, 2]),
      );
      expect(r.rows[0]).toEqual({ a: 40, b: 42 });
    });
  });

  it('pole je JEDEN parametr, ne rozlozene hodnoty', async () => {
    await withWorkspace(ctx.workspace, async (tx) => {
      const ids = ['a', 'b', 'c'];
      const r = await tx.execute<{ n: number }>(
        rawSql(`SELECT count(*)::int AS n FROM unnest($1::text[]) x`, [ids]),
      );
      expect(r.rows[0]!.n).toBe(3);
    });
  });

  it('hodnota zustane hodnotou, i kdyz vypada jako SQL', async () => {
    await withWorkspace(ctx.workspace, async (tx) => {
      const evil = `'; DROP TABLE campaigns; --`;
      const r = await tx.execute<{ t: string }>(rawSql(`SELECT $1::text AS t`, [evil]));
      expect(r.rows[0]!.t).toBe(evil);
    });
  });

  it('odkaz na chybejici parametr spadne pri sestaveni, ne v databazi', () => {
    expect(() => rawSql(`SELECT $2::int`, [1])).toThrow(/\$2/);
  });

  it('SQLSTATE se cte pres pgErrorCode, ne z err.code', async () => {
    let caught: unknown;
    await withWorkspace(ctx.workspace, async (tx) => {
      await tx.execute(rawSql(`CREATE TEMP TABLE t_uq (id int PRIMARY KEY)`, []));
      await tx.execute(rawSql(`INSERT INTO t_uq VALUES ($1)`, [1]));
      try {
        await tx.execute(rawSql(`INSERT INTO t_uq VALUES ($1)`, [1]));
      } catch (e) {
        caught = e;
      }
    }).catch(() => undefined);
    expect((caught as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(caught)).toBe('23505');
  });
});
