import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '../tx';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { asMigrator, closeMigratorPool } from '../test-support/migrator';
import { hashPassword, verifyPassword } from './password';
import { createSession, verifySessionToken } from './session';
import {
  requestPasswordReset,
  confirmPasswordReset,
  RESET_TOKEN_TTL_MINUTES,
  __lastIssuedTokenForTests,
} from './password-reset';

let harness: PgHarness;

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let userId = '';
let email = '';

const request = () =>
  requestPasswordReset({ email, ip: '10.0.0.1', userAgent: 'vitest', requestId: 'r' });

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await closeMigratorPool();
  await harness?.stop();
});

beforeEach(async () => {
  email = `pr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(OLD),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });
});

/** audit_log má RLS, čtení proto běží pod migrátorem. Viz komentář v login.test.ts. */
async function auditRows(
  sqlText: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  return asMigrator(async (db) => {
    const result = await db.query(sqlText, params);
    return result.rows as Array<Record<string, unknown>>;
  });
}

describe('requestPasswordReset', () => {
  it('platnost tokenu je 60 minut podle 3.1', () => {
    expect(RESET_TOKEN_TTL_MINUTES).toBe(60);
  });

  it('pro existující účet vytvoří token a uloží jen jeho hash', async () => {
    await request();
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ token_hash: Buffer; used_at: Date | null }>(
        sql`SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id = ${userId}::uuid`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.used_at).toBeNull();
    expect(rows[0]!.token_hash).toHaveLength(32);
  });

  it('pro neexistující účet neselže a nic nevytvoří', async () => {
    const before = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT count(*)::int AS n FROM password_reset_tokens`);
      return (result.rows[0] as { n: number }).n;
    });
    await expect(
      requestPasswordReset({
        email: `nikdo-${Date.now()}@example.cz`,
        ip: '10.0.0.1',
        userAgent: 'v',
        requestId: 'r',
      }),
    ).resolves.toBeUndefined();
    const after = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT count(*)::int AS n FROM password_reset_tokens`);
      return (result.rows[0] as { n: number }).n;
    });
    expect(after).toBe(before);
  });

  it('nové vyžádání zneplatní předchozí nepoužité tokeny', async () => {
    await request();
    const first = __lastIssuedTokenForTests();
    await request();
    const second = __lastIssuedTokenForTests();
    expect(first).not.toBe(second);

    await expect(
      confirmPasswordReset({
        token: first!,
        newPassword: NEW,
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('zapíše user.password_reset_requested do audit logu', async () => {
    await request();
    const rows = await auditRows(
      `SELECT 1 FROM audit_log WHERE actor_id = $1::uuid AND action = 'user.password_reset_requested'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('confirmPasswordReset', () => {
  it('nastaví nové heslo a token spotřebuje', async () => {
    await request();
    const token = __lastIssuedTokenForTests()!;
    await confirmPasswordReset({
      token,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });

    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);

    await expect(
      confirmPasswordReset({ token, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokuje VŠECHNY relace uživatele, i tu aktuální', async () => {
    const session = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: null }),
    );
    await request();
    await confirmPasswordReset({
      token: __lastIssuedTokenForTests()!,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    await expect(
      withoutContext((tx) => verifySessionToken(tx, session.token)),
    ).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('prošlý token vrací unauthenticated', async () => {
    await request();
    const token = __lastIssuedTokenForTests()!;
    await withoutContext((tx) =>
      tx.execute(
        sql`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = ${userId}::uuid`,
      ),
    );
    await expect(
      confirmPasswordReset({ token, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('nové heslo prochází pravidly z 3.1', async () => {
    await request();
    await expect(
      confirmPasswordReset({
        token: __lastIssuedTokenForTests()!,
        newPassword: 'kratke',
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('zapíše user.password_reset_completed s workspace_id NULL', async () => {
    await request();
    await confirmPasswordReset({
      token: __lastIssuedTokenForTests()!,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const rows = await auditRows(
      `SELECT workspace_id FROM audit_log WHERE actor_id = $1::uuid AND action = 'user.password_reset_completed'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBeNull();
  });
});
