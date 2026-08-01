import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withoutContext } from '../tx';
import { ApiError } from '../errors/api-error';
import { hashPassword } from './password';
import { tokenHash } from './token';
import {
  SESSION_COOKIE_NAME,
  LAST_USED_THROTTLE_MS,
  createSession,
  verifySessionToken,
  revokeSession,
  revokeUserSessions,
  serializeSessionCookie,
  clearSessionCookie,
} from './session';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 300_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

async function makeUser(email: string): Promise<string> {
  return withoutContext(async (tx) => {
    const [row] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        name: 'Test',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return row!.id;
  });
}

describe('cookie', () => {
  it('má jméno ml_session a atributy podle 3.2 (kritérium 14)', () => {
    const cookie = serializeSessionCookie('token-hodnota', {
      secure: true,
      maxAgeSeconds: 2592000,
    });
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=token-hodnota;`)).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('bez https se Secure nenastaví', () => {
    expect(serializeSessionCookie('t', { secure: false, maxAgeSeconds: 60 })).not.toContain(
      'Secure',
    );
  });

  it('atribut Domain se nenastavuje, cookie je host-only', () => {
    expect(serializeSessionCookie('t', { secure: true, maxAgeSeconds: 60 })).not.toContain(
      'Domain',
    );
  });

  it('mazací cookie má Max-Age=0 a prázdnou hodnotu', () => {
    const cookie = clearSessionCookie({ secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('životní cyklus session', () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUser(`u${Date.now()}${Math.random()}@example.cz`);
  });

  it('createSession uloží jen hash tokenu, nikdy token', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(Buffer.from(row!.tokenHash).equals(tokenHash(token))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.csrfSecret).toHaveLength(32);
  });

  it('platná session se ověří a vrátí userId', async () => {
    const { token } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const verified = await withoutContext((tx) => verifySessionToken(tx, token));
    expect(verified.userId).toBe(userId);
  });

  it('neznámý token vrací unauthenticated', async () => {
    await expect(
      withoutContext((tx) => verifySessionToken(tx, 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14')),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokovaná session vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeSession(tx, sessionId, 'logout'));
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('session po absolutní expiraci vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ absoluteExpiresAt: sql`now() - interval '1 second'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('session po nečinnosti delší než idle TTL vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ lastUsedAt: sql`now() - interval '15 days'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('last_used_at se nezapisuje častěji než jednou za 5 minut', async () => {
    expect(LAST_USED_THROTTLE_MS).toBe(5 * 60 * 1000);
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const before = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    await withoutContext((tx) => verifySessionToken(tx, token));
    const after = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(new Date(after[0]!.lastUsedAt).getTime()).toBe(
      new Date(before[0]!.lastUsedAt).getTime(),
    );
  });

  it('po překročení throttle se last_used_at posune', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ lastUsedAt: sql`now() - interval '10 minutes'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await withoutContext((tx) => verifySessionToken(tx, token));
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(Date.now() - new Date(row!.lastUsedAt).getTime()).toBeLessThan(60_000);
  });

  it('revokeUserSessions umí vynechat aktuální relaci (kritérium 17)', async () => {
    const a = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }),
    );
    const b = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'b', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeUserSessions(tx, userId, 'password_changed', a.sessionId));
    await expect(withoutContext((tx) => verifySessionToken(tx, a.token))).resolves.toMatchObject({
      userId,
    });
    await expect(withoutContext((tx) => verifySessionToken(tx, b.token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('revokeUserSessions bez výjimky zruší i aktuální relaci (kritérium 18)', async () => {
    const a = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeUserSessions(tx, userId, 'logout_all'));
    await expect(withoutContext((tx) => verifySessionToken(tx, a.token))).rejects.toThrow(ApiError);
  });

  it('revokovaná session se z databáze nemaže, aby šel vypsat konec relace', async () => {
    const { sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeSession(tx, sessionId, 'logout'));
    const rows = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedReason).toBe('logout');
  });
});
