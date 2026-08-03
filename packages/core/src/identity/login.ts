import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext, withUser } from '../tx';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from './password';
import { AUTH_MIN_RESPONSE_MS, withConstantTime } from './constant-time';
import { loginThrottlingDisabled } from './throttle';
import { createSession } from './session';
import { IdentityAuditActions } from './audit';
import type { Role } from './types';

/** 3.1: per účet 10 neúspěchů, pak zamknout na 15 minut. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  email_verified_at: string | null;
  created_at: string;
};

export type WorkspaceSummary = { id: string; name: string; slug: string; role: Role };

export type LoginInput = {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

export type LoginResult = {
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  token: string;
  sessionId: string;
};

export function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    timezone: row.timezone,
    email_verified_at: row.emailVerifiedAt ? new Date(row.emailVerifiedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

export async function listWorkspacesOfUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        role: schema.memberships.role,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(
          // Pořadí argumentů je záměrné, stejně jako v `context.ts`: je to
          // spojení sloupce se sloupcem, ne filtr podle workspace. Opačné
          // pořadí vypadá jako ruční obcházení `wsEq` a test disciplíny
          // izolace ve `scope.test.ts` ho označí za porušení.
          eq(schema.workspaces.id, schema.memberships.workspaceId),
          eq(schema.memberships.userId, userId),
        ),
      )
      .where(isNull(schema.workspaces.deletedAt))
      .orderBy(schema.workspaces.name),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, role: r.role as Role }));
}

/**
 * 3.7: user.login_failed se zapisuje MIMO transakci, protože k žádné změně
 * nedochází. Zapisuje se i pro neexistující účet, jinak by se cesty daly odlišit
 * podle toho, jestli po requestu přibyl řádek.
 */
async function recordFailedLogin(input: {
  userId: string | null;
  email: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
}): Promise<void> {
  await withoutContext(async (tx) => {
    if (input.userId) {
      // S vypnutými brzdami (LOGIN_THROTTLING_DISABLED) se čítač dál počítá,
      // jen se z něj nikdy nestane zámek. Čítač je informace, zámek je brzda,
      // a vypínač vypíná brzdy.
      const lockClause = loginThrottlingDisabled()
        ? sql`locked_until`
        : sql`CASE
                 WHEN failed_login_count + 1 >= ${LOGIN_MAX_FAILURES}
                 THEN now() + interval '${sql.raw(String(LOGIN_LOCK_MINUTES))} minutes'
                 ELSE locked_until END`;
      await tx.execute(sql`
        UPDATE users
           SET failed_login_count = failed_login_count + 1,
               locked_until = ${lockClause},
               updated_at = now()
         WHERE id = ${input.userId}::uuid
      `);
    }
    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.login_failed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });
}

/**
 * Přihlášení. Celé běží uvnitř časové podlahy, protože kritérium 16 měří rozdíl
 * mediánu odpovědi mezi existujícím a neexistujícím účtem a dummy hash sám
 * o sobě nestačí: existující účet má navíc dotazy a zápisy.
 */
export function login(input: LoginInput): Promise<LoginResult> {
  // S vypnutými brzdami je podlaha nula, takže se jen nedospává. Kritérium 16
  // tím padá, ale to je celý smysl vypínače a mimo produkci nikoho neohrožuje.
  const floorMs = loginThrottlingDisabled() ? 0 : AUTH_MIN_RESPONSE_MS;
  return withConstantTime(floorMs, () => performLogin(input));
}

async function performLogin(input: LoginInput): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const [user] = await withoutContext((tx) =>
    tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1),
  );

  // Neexistující nebo smazaný účet: hash nad dummy PHC řetězcem, aby se nedal
  // měřit rozdíl, a stejný kód jako u špatného hesla.
  if (!user) {
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
    await recordFailedLogin({
      userId: null,
      email,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    throw new ApiError('invalid_credentials');
  }

  // Vypršelý zámek se nuluje dřív, než se cokoliv ověřuje.
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() <= Date.now()) {
    await withoutContext((tx) =>
      tx
        .update(schema.users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(schema.users.id, user.id)),
    );
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }

  // Zámek z dřívějška se s vypnutými brzdami ignoruje, jinak by vypínač
  // nepomohl právě tomu, kdo se už zamknout stihl. Sloupec se nemaže,
  // vynuluje ho první úspěšné přihlášení níž.
  if (user.lockedUntil && !loginThrottlingDisabled()) {
    const retryAfter = Math.max(
      1,
      Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000),
    );
    // Stejná práce jako na ostatních cestách, aby zamčený účet nešel poznat podle času.
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
    throw new ApiError('account_locked', { retryAfter });
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    await recordFailedLogin({
      userId: user.id,
      email,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    throw new ApiError('invalid_credentials');
  }

  // 3.1: rehash při přihlášení, aby se instalace samy posunuly, až parametry zpřísníme.
  const rehashed = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;

  const session = await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        ...(rehashed ? { passwordHash: rehashed } : {}),
      })
      .where(eq(schema.users.id, user.id));

    const created = await createSession(tx, {
      userId: user.id,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.login'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return created;
  });

  return {
    user: toPublicUser(user),
    workspaces: await listWorkspacesOfUser(user.id),
    token: session.token,
    sessionId: session.sessionId,
  };
}
