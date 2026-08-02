import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { queueSystemMail } from '../platform/system-mail';
import { assertPasswordPolicy, hashPassword } from './password';
import { generateOpaqueToken, tokenHash } from './token';
import { revokeUserSessions } from './session';
import { AUTH_MIN_RESPONSE_MS, withConstantTime } from './constant-time';
import { IdentityAuditActions } from './audit';

/** 3.1: token platí 60 minut a je jednorázový. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** Konfigurace se čte líně, viz komentář v `session.ts`. */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

let lastIssuedToken: string | null = null;

/**
 * Jen pro testy. V provozu se token nikde neuchovává, odchází pouze e-mailem.
 * Funkce je pojmenovaná dvěma podtržítky schválně, aby bylo na první pohled
 * vidět, že do produkční cesty nepatří.
 */
export function __lastIssuedTokenForTests(): string | null {
  return lastIssuedToken;
}

export type RequestResetInput = {
  email: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.1: vrací se vždy 202 bez ohledu na existenci účtu a se stejnou latencí.
 * Endpoint proto nikdy nehází, jen mlčky nic neudělá, a celé volání běží uvnitř
 * časové podlahy jako přihlášení (kritérium 16).
 */
export function requestPasswordReset(input: RequestResetInput): Promise<void> {
  return withConstantTime(AUTH_MIN_RESPONSE_MS, () => performResetRequest(input));
}

async function performResetRequest(input: RequestResetInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  const [user] = await withoutContext((tx) =>
    tx
      .select({ id: schema.users.id, locale: schema.users.locale })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1),
  );

  // Token se generuje vždy, i pro neexistující účet: generování je měřitelná
  // práce a jeho vynechání by cestu zkrátilo.
  const token = generateOpaqueToken();
  const hash = tokenHash(token);
  if (!user) {
    lastIssuedToken = null;
    return;
  }
  lastIssuedToken = token;

  await withoutContext(async (tx) => {
    // Nové vyžádání invaliduje předchozí nepoužité tokeny téhož uživatele (3.1).
    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${user.id}::uuid AND used_at IS NULL
    `);
    await tx.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: sql`now() + interval '${sql.raw(String(RESET_TOKEN_TTL_MINUTES))} minutes'`,
    });
    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_reset_requested'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  await queueSystemMail({
    template: 'password_reset',
    to: email,
    locale: user.locale,
    data: { url: `${cfg().APP_URL}/reset-password?token=${token}` },
    // Bez uživatele by odesílatel neměl kudy najít projekt, a tím ani odesílací
    // účet. Obnova hesla projekt z principu nemá: kdo zapomene heslo, není přihlášený.
    userId: user.id,
  });
}

export type ConfirmResetInput = {
  token: string;
  newPassword: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.1: po úspěšné změně se nastaví password_changed_at, revokují se VŠECHNY
 * relace uživatele (na rozdíl od změny hesla, kde aktuální zůstává, protože
 * tady žádná aktuální není), revokují se nepoužité reset tokeny a zapíše se audit.
 */
export async function confirmPasswordReset(input: ConfirmResetInput): Promise<void> {
  const hash = tokenHash(input.token);

  const [row] = await withoutContext((tx) =>
    tx
      .select({
        id: schema.passwordResetTokens.id,
        userId: schema.passwordResetTokens.userId,
        expiresAt: schema.passwordResetTokens.expiresAt,
        usedAt: schema.passwordResetTokens.usedAt,
      })
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, hash))
      .limit(1),
  );

  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new ApiError('unauthenticated');
  }

  const [user] = await withoutContext((tx) =>
    tx
      .select({ id: schema.users.id, email: schema.users.email, locale: schema.users.locale })
      .from(schema.users)
      .where(and(eq(schema.users.id, row.userId), isNull(schema.users.deletedAt)))
      .limit(1),
  );
  if (!user) throw new ApiError('unauthenticated');

  assertPasswordPolicy(input.newPassword, user.email);
  const newHash = await hashPassword(input.newPassword);

  await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${user.id}::uuid AND used_at IS NULL
    `);

    await revokeUserSessions(tx, user.id, 'password_reset');

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_reset_completed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: user.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  await queueSystemMail({
    template: 'password_changed',
    to: user.email,
    locale: user.locale,
    data: { changed_at: new Date().toISOString() },
    userId: user.id,
  });
}
