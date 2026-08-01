import { randomBytes } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { generateOpaqueToken, tokenHash } from './token';

/**
 * Odchylka od plánu. Tabulka 0.6 slibovala, že `@mlain/core/config` vydá hotový
 * objekt `config`. P01 nakonec vydal jen továrnu `loadConfig()`, takže se sem
 * konfigurace načítá LÍNĚ a memoizuje.
 *
 * Líně, ne při importu modulu: `loadConfig()` hází `ConfigError`, když chybí
 * proměnná prostředí, a při načtení na úrovni modulu by na tom spadl import
 * celého souboru. Tím by padly i testy cookie, které na konfiguraci vůbec
 * nezávisí, a chyba by vypadala jako porucha sessions.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

// Jméno je v samostatném listovém modulu, aby ho mohla číst i `proxy.ts`,
// aniž by si do bundlu vtáhla drizzle, schéma a konfiguraci. Viz `cookie.ts`.
export { SESSION_COOKIE_NAME } from './cookie';
import { SESSION_COOKIE_NAME } from './cookie';
/** 7: bez throttlingu by sessions generovaly nejvíc WAL v celém systému. */
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
export const CSRF_SECRET_BYTES = 32;

export type RevokedReason =
  'logout' | 'logout_all' | 'password_changed' | 'password_reset' | 'user_deleted' | 'admin_action';

export type CreatedSession = { token: string; sessionId: string; csrfSecret: Buffer };

export type VerifiedSession = {
  sessionId: string;
  userId: string;
  csrfSecret: Buffer;
  lastUsedAt: Date;
};

/**
 * 3.2: opaque token v databázi, ne JWT. Důvod je okamžitá revokace.
 * Ověření session je jediný indexovaný lookup podle hashe.
 */
export async function createSession(
  tx: Tx,
  input: { userId: string; userAgent: string; ip: string | null },
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const csrfSecret = randomBytes(CSRF_SECRET_BYTES);
  const [row] = await tx
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tokenHash: tokenHash(token),
      csrfSecret,
      userAgent: input.userAgent.slice(0, 500),
      ip: input.ip,
      absoluteExpiresAt: sql`now() + interval '${sql.raw(String(cfg().SESSION_ABSOLUTE_TTL_DAYS))} days'`,
    })
    .returning({ id: schema.sessions.id });
  return { token, sessionId: row!.id, csrfSecret };
}

/**
 * Ověří token a vrátí session. Neznámý token je `unauthenticated`, známý ale
 * neplatný je `session_expired`: rozdíl nic neprozrazuje (token zná jen ten,
 * komu byl vydán) a klientovi říká, jestli se má přihlásit znovu.
 */
export async function verifySessionToken(tx: Tx, token: string): Promise<VerifiedSession> {
  const [row] = await tx
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash(token)))
    .limit(1);

  if (!row) throw new ApiError('unauthenticated');
  if (row.revokedAt) throw new ApiError('session_expired');

  const now = Date.now();
  if (new Date(row.absoluteExpiresAt).getTime() <= now) throw new ApiError('session_expired');

  const idleLimitMs = cfg().SESSION_IDLE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const lastUsedAt = new Date(row.lastUsedAt);
  if (now - lastUsedAt.getTime() > idleLimitMs) throw new ApiError('session_expired');

  if (now - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await tx
      .update(schema.sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.sessions.id, row.id));
  }

  return {
    sessionId: row.id,
    userId: row.userId,
    csrfSecret: Buffer.from(row.csrfSecret),
    lastUsedAt,
  };
}

export async function revokeSession(
  tx: Tx,
  sessionId: string,
  reason: RevokedReason,
): Promise<void> {
  await tx
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

/**
 * Revokuje všechny živé relace uživatele. `exceptSessionId` se používá při změně
 * hesla, aby se uživatel nevyhodil sám (3.2); u `logout-all` se nepředává.
 */
export async function revokeUserSessions(
  tx: Tx,
  userId: string,
  reason: RevokedReason,
  exceptSessionId?: string,
): Promise<number> {
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(schema.sessions.id, exceptSessionId));
  const revoked = await tx
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });
  return revoked.length;
}

export async function listUserSessions(tx: Tx, userId: string) {
  return tx
    .select({
      id: schema.sessions.id,
      ip: schema.sessions.ip,
      user_agent: schema.sessions.userAgent,
      created_at: schema.sessions.createdAt,
      last_used_at: schema.sessions.lastUsedAt,
      revoked_at: schema.sessions.revokedAt,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    .orderBy(sql`${schema.sessions.lastUsedAt} DESC`);
}

/** 3.2: Secure jen když APP_URL začíná https, atribut Domain se nenastavuje. */
export function isSecureCookieContext(): boolean {
  return cfg().APP_URL.startsWith('https://');
}

export function serializeSessionCookie(
  token: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

/**
 * Odchylka od plánu: plán tu měl konstantu `SESSION_MAX_AGE_SECONDS`. Ta by
 * ale konfiguraci načetla už při importu modulu, čímž by se líné načítání výš
 * obešlo a import souboru by bez proměnných prostředí spadl. Je to proto funkce.
 */
export function sessionMaxAgeSeconds(): number {
  return cfg().SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60;
}
