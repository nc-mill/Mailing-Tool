import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '../tx';
import type { ApiError } from '../errors/api-error';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { asMigrator, closeMigratorPool } from '../test-support/migrator';
import { hashPassword } from './password';
import { login, LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES } from './login';

/**
 * ODCHYLKA OD PLÁNU, stejná jako ve všech ostatních databázových testech tohohle
 * balíčku: kontejner si zakládá soubor sám přes `startPgHarness()`. Skript
 * `test:db` ani projekt `db` ve `vitest.config.ts` neexistuje a obojí leží
 * v souborech, které vlastní P01 (viz komentář v `test-support/pg-harness.ts`).
 */
let harness: PgHarness;

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let userId = '';

const attempt = (password: string) =>
  login({ email, password, ip: '10.0.0.1', userAgent: 'vitest', requestId: 'r1' });

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await closeMigratorPool();
  await harness?.stop();
});

/**
 * ODCHYLKA OD PLÁNU. Plán četl audit_log přes `withoutContext`, jenže na
 * `audit_log` je RLS a pod aplikační rolí bez kontextu nevrátí ANI ŘÁDEK:
 * `ws_isolation_audit` v USING porovnává s `mlain.workspace_id` (tady NULL)
 * a `user_own_global_audit` vyžaduje nastavený `mlain.user_id`, který
 * `withoutContext` z principu nenastavuje. Řádek s `actor_id IS NULL`
 * (neúspěch u neexistujícího účtu) navíc nepřečte ani `withUser`.
 *
 * Ověření zápisu proto běží pod `mlain_migrator`, tedy pod rolí, která RLS
 * obchází. Je to pravidlo z kapitoly 0.9: úklid a kontroly mimo aplikační
 * cestu patří migrátorovi. Testovaná cesta (zápis) zůstává pod `mlain_app`.
 */
async function auditRows(
  sqlText: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  return asMigrator(async (db) => {
    const result = await db.query(sqlText, params);
    return result.rows as Array<Record<string, unknown>>;
  });
}

beforeEach(async () => {
  email = `login-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(PASSWORD),
        name: 'Petr',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });
});

describe('úspěšné přihlášení', () => {
  it('vrátí uživatele, token a seznam projektů', async () => {
    const result = await attempt(PASSWORD);
    expect(result.user.id).toBe(userId);
    expect(result.user.email).toBe(email);
    expect(result.token).toHaveLength(43);
    expect(Array.isArray(result.workspaces)).toBe(true);
  });

  it('vynuluje čítač neúspěchů a nastaví last_login_at', async () => {
    await attempt('spatne-heslo-uplne').catch(() => undefined);
    await attempt(PASSWORD);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.failedLoginCount).toBe(0);
    expect(row!.lockedUntil).toBeNull();
    expect(row!.lastLoginAt).not.toBeNull();
  });

  it('zapíše user.login do audit logu s workspace_id NULL', async () => {
    await attempt(PASSWORD);
    const rows = await auditRows(
      `SELECT action, workspace_id FROM audit_log WHERE actor_id = $1::uuid AND action = 'user.login'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBeNull();
  });

  it('nikdy nevrací password_hash', async () => {
    expect(JSON.stringify(await attempt(PASSWORD))).not.toContain('argon2');
  });
});

describe('neúspěšné přihlášení', () => {
  it('špatné heslo vrací invalid_credentials 401', async () => {
    await expect(attempt('uplne-jine-heslo')).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    });
  });

  it('neexistující účet vrací tentýž kód, ne not_found', async () => {
    await expect(
      login({
        email: 'nikdo@example.cz',
        password: PASSWORD,
        ip: '10.0.0.1',
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('měkce smazaný účet vrací tentýž kód', async () => {
    await withoutContext((tx) =>
      tx.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, userId)),
    );
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('zapíše user.login_failed do audit logu', async () => {
    await attempt('uplne-jine-heslo').catch(() => undefined);
    const rows = await auditRows(
      `SELECT action FROM audit_log WHERE actor_id = $1::uuid AND action = 'user.login_failed'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
  });

  it('audit neúspěchu vznikne i u neexistujícího účtu, aby se cesty nelišily', async () => {
    const unknownEmail = `nikdo-${Date.now()}@example.cz`;
    await login({
      email: unknownEmail,
      password: PASSWORD,
      ip: '10.0.0.1',
      userAgent: 'v',
      requestId: 'r',
    }).catch(() => undefined);
    const rows = await auditRows(
      `SELECT actor_label FROM audit_log WHERE action = 'user.login_failed' AND actor_label = $1`,
      [unknownEmail],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('kritérium 15: zamčení účtu', () => {
  it('meze odpovídají 3.1', () => {
    expect(LOGIN_MAX_FAILURES).toBe(10);
    expect(LOGIN_LOCK_MINUTES).toBe(15);
  });

  it('deset neúspěchů vede k 423 account_locked', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    try {
      await attempt('uplne-jine-heslo');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('account_locked');
      expect(err.status).toBe(423);
      expect(err.retryAfter).toBeGreaterThan(0);
      expect(err.retryAfter).toBeLessThanOrEqual(15 * 60);
    }
  }, 60_000);

  it('jedenáctý pokus se SPRÁVNÝM heslem taky selže, dokud zámek trvá', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: 'account_locked' });
  }, 60_000);

  it('po vypršení zámku se čítač vynuluje a správné heslo projde', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    await withoutContext((tx) =>
      tx
        .update(schema.users)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(schema.users.id, userId)),
    );
    const result = await attempt(PASSWORD);
    expect(result.user.id).toBe(userId);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.failedLoginCount).toBe(0);
  }, 60_000);
});

describe('rehash při přihlášení', () => {
  it('slabší parametry se po úspěšném přihlášení přehashují', async () => {
    // Odchylka od plánu: plán tu nejdřív ukládal poškozený PHC řetězec a hned
    // ho přepisoval hashem s aktuálními parametry, takže netestoval nic.
    // Uloží se hash se SKUTEČNĚ slabšími parametry (m=8192, t=1), aby
    // needsRehash() vrátil true a přehashování šlo změřit.
    const weak = await hashWithWeakParams(PASSWORD);
    await withoutContext((tx) =>
      tx.update(schema.users).set({ passwordHash: weak }).where(eq(schema.users.id, userId)),
    );
    await attempt(PASSWORD);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.passwordHash).toContain('m=19456,t=2,p=1');
  });
});

async function hashWithWeakParams(raw: string): Promise<string> {
  const { hash } = await import('@node-rs/argon2');
  return hash(raw.normalize('NFKC'), {
    algorithm: 2,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
    outputLen: 32,
  });
}
