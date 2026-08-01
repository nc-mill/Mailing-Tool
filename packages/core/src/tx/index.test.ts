import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import {
  appPool,
  closePools,
  pgErrorCode,
  withoutContext,
  withReadOnly,
  withUser,
  withWorkspace,
} from './index';

/**
 * ODCHYLKA OD PLÁNU: plán počítal s tím, že `DATABASE_URL` míří na běžící
 * databázi a testy se pouštějí přes samostatný skript `test:db`. Balíček
 * `@mlain/core` žádný takový skript ani projekt `db` ve `vitest.config.ts`
 * nemá a obojí leží v souborech, které vlastní P01. Kontejner si proto zakládá
 * test sám, přes společný harness v `test-support/pg-harness.ts`.
 *
 * Aplikační spojení běží pod `mlain_app`, tedy pod rolí, na kterou RLS dopadá.
 * Pod vlastníkem schématu by testy izolace byly falešně zelené.
 */
let harness: PgHarness;

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const USER = '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071';
const userCtx = unsafeWorkspaceContext(WS, { type: 'user', userId: USER, role: 'owner' });
const keyCtx = unsafeWorkspaceContext(WS, { type: 'api_key', apiKeyId: 'k', scopes: [] });

type Gucs = { u: string | null; w: string | null };
const readGucs = sql`select current_setting('mlain.user_id', true) as u,
                            current_setting('mlain.workspace_id', true) as w`;
const empty = (value: string | null) => value === null || value === '';

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

describe('tx adaptér', () => {
  it('handle má Drizzle API, ne syrový klient', async () => {
    await withoutContext(async (tx) => {
      expect(typeof tx.select).toBe('function');
      expect(typeof tx.insert).toBe('function');
      expect(typeof tx.delete).toBe('function');
      expect(typeof tx.execute).toBe('function');
    });
  });

  it('tx.execute vrací QueryResult s .rows, ne pole', async () => {
    await withoutContext(async (tx) => {
      const result = await tx.execute<{ n: number }>(sql`select 42 as n`);
      expect(Array.isArray(result), 'kdyby to bylo pole, celý plán by mohl indexovat přímo').toBe(
        false,
      );
      expect(result.rows[0]!.n).toBe(42);
    });
  });

  it('withWorkspace nastaví oba GUC, protože aktér je uživatel', async () => {
    const row = await withWorkspace(
      userCtx,
      async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!,
    );
    expect(row.w).toBe(WS);
    expect(row.u, 'bez tohohle by doménové služby musely volat set_config ručně').toBe(USER);
  });

  it('withWorkspace s API klíčem nenastaví mlain.user_id', async () => {
    const row = await withWorkspace(
      keyCtx,
      async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!,
    );
    expect(row.w).toBe(WS);
    expect(empty(row.u)).toBe(true);
  });

  it('withUser nastaví jen mlain.user_id', async () => {
    const row = await withUser(USER, async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(row.u).toBe(USER);
    expect(empty(row.w)).toBe(true);
  });

  it('withoutContext nenastaví ani jeden GUC', async () => {
    const row = await withoutContext(async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(empty(row.u)).toBe(true);
    expect(empty(row.w)).toBe(true);
  });

  it('GUC nepřežije transakci, protože se nastavuje jako SET LOCAL', async () => {
    await withWorkspace(userCtx, async () => undefined);
    const after = await withoutContext(async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!.w);
    expect(
      empty(after),
      'kdyby to byl SET místo SET LOCAL, další nájemce spojení by zdědil cizí projekt',
    ).toBe(true);
  });

  it('zápis přes Drizzle handle je uvnitř transakce od P03, takže ho chyba vezme s sebou', async () => {
    const id = '0192f3a0-1c2d-7e42-9a1b-2c3d4e5f6071';
    await expect(
      withoutContext(async (tx) => {
        await tx
          .insert(schema.users)
          .values({ id, email: 'rollback@probe.test', passwordHash: 'x' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const left = await withoutContext(async (tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, id)),
    );
    expect(left).toHaveLength(0);
  });

  it('withReadOnly drží kontext a zápis odmítne', async () => {
    const w = await withReadOnly(
      userCtx,
      { statementTimeoutMs: 3000 },
      async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!.w,
    );
    expect(w).toBe(WS);
    await expect(
      withReadOnly(userCtx, { statementTimeoutMs: 3000 }, async (tx) => {
        await tx.insert(schema.users).values({
          id: '0192f3a0-1c2d-7e43-9a1b-2c3d4e5f6071',
          email: 'ro@probe.test',
          passwordHash: 'x',
        });
      }),
    ).rejects.toThrow();
  });

  it('přepnutí kontextu zevnitř transakce ji zruší', async () => {
    await expect(
      withWorkspace(userCtx, async (tx) => {
        await tx.execute(sql`select set_config('mlain.workspace_id',
                                               '00000000-0000-0000-0000-000000000000', true)`);
      }),
    ).rejects.toThrow(/kontext projektu/);
  });

  it('pgErrorCode vytáhne SQLSTATE z DrizzleQueryError', async () => {
    const id = '0192f3a0-1c2d-7e44-9a1b-2c3d4e5f6071';
    await withoutContext(async (tx) => {
      await tx.insert(schema.users).values({ id, email: 'dup@probe.test', passwordHash: 'x' });
    });
    try {
      await withoutContext(async (tx) => {
        await tx.insert(schema.users).values({
          id: '0192f3a0-1c2d-7e45-9a1b-2c3d4e5f6071',
          email: 'dup@probe.test',
          passwordHash: 'x',
        });
      });
      expect.unreachable('duplicitní e-mail musí selhat na unikátním indexu');
    } catch (error) {
      expect(
        (error as { code?: unknown }).code,
        'SQLSTATE NENÍ na err.code, Drizzle chybu zabaluje',
      ).toBeUndefined();
      expect(pgErrorCode(error)).toBe('23505');
    }
    await withoutContext(async (tx) => {
      await tx.delete(schema.users).where(eq(schema.users.email, 'dup@probe.test'));
    });
  });

  it('pool je singleton, ne nový pool na každé volání', () => {
    expect(appPool()).toBe(appPool());
  });
});
