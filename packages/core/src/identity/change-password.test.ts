import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { closePools, withoutContext } from '../tx';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { asMigrator, closeMigratorPool } from '../test-support/migrator';
import { hashPassword, verifyPassword } from './password';
import { createSession, verifySessionToken } from './session';
import { changePassword } from './change-password';

let harness: PgHarness;

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let userId = '';
let email = '';

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await closeMigratorPool();
  await harness?.stop();
});

beforeEach(async () => {
  email = `chp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
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

describe('changePassword', () => {
  it('uloží nové heslo a posune password_changed_at', async () => {
    const current = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'v', ip: null }),
    );
    await changePassword({
      userId,
      email,
      currentSessionId: current.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);
    expect(new Date(row!.passwordChangedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('kritérium 17: revokuje všechny ostatní relace a aktuální nechá', async () => {
    const keep = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: null }),
    );
    const other = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'b', ip: null }),
    );

    await changePassword({
      userId,
      email,
      currentSessionId: keep.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });

    await expect(withoutContext((tx) => verifySessionToken(tx, keep.token))).resolves.toMatchObject(
      { userId },
    );
    await expect(withoutContext((tx) => verifySessionToken(tx, other.token))).rejects.toMatchObject(
      {
        code: 'session_expired',
      },
    );
  });

  it('revokované relace nesou důvod password_changed', async () => {
    const keep = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: null }),
    );
    await withoutContext((tx) => createSession(tx, { userId, userAgent: 'b', ip: null }));
    await changePassword({
      userId,
      email,
      currentSessionId: keep.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ revoked_reason: string }>(
        sql`SELECT revoked_reason FROM sessions WHERE user_id = ${userId}::uuid AND revoked_at IS NOT NULL`,
      );
      return result.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.revoked_reason === 'password_changed')).toBe(true);
  });

  it('špatné současné heslo vrací invalid_credentials a nic nezmění', async () => {
    const current = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'v', ip: null }),
    );
    await expect(
      changePassword({
        userId,
        email,
        currentSessionId: current.sessionId,
        currentPassword: 'uplne-jine-heslo',
        newPassword: NEW,
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, OLD)).toBe(true);
  });

  it('nové heslo prochází pravidly z 3.1', async () => {
    const current = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'v', ip: null }),
    );
    await expect(
      changePassword({
        userId,
        email,
        currentSessionId: current.sessionId,
        currentPassword: OLD,
        newPassword: 'kratke',
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('kritérium 21b: zapíše user.password_changed s workspace_id NULL a transakce se nerollbackne', async () => {
    const current = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'v', ip: null }),
    );
    await changePassword({
      userId,
      email,
      currentSessionId: current.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });

    const audit = await auditRows(
      `SELECT workspace_id FROM audit_log WHERE actor_id = $1::uuid AND action = 'user.password_changed'`,
      [userId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.workspace_id).toBeNull();

    // Heslo je po volání opravdu změněné, tedy transakce se skutečně commitla.
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);
  });
});
