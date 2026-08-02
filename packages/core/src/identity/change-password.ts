import { eq, isNull, and, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '../tx';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { queueSystemMail } from '../platform/system-mail';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';
import { revokeUserSessions } from './session';
import { IdentityAuditActions } from './audit';

export type ChangePasswordInput = {
  userId: string;
  email: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.2: změna hesla revokuje všechny relace uživatele KROMĚ aktuální, aby se
 * uživatel nevyhodil sám. Do revoked_reason se zapíše password_changed.
 *
 * Celá operace je jedna transakce BEZ workspace kontextu (k žádnému projektu
 * nepatří). Auditní řádek má proto workspace_id NULL a politika
 * ws_isolation_audit ho musí ve WITH CHECK pustit, jinak by INSERT vzal
 * s sebou celou transakci a heslo by se neuložilo. Přesně tohle měří
 * kritérium 21b.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const [user] = await withoutContext((tx) =>
    tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, input.userId), isNull(schema.users.deletedAt)))
      .limit(1),
  );
  if (!user) throw new ApiError('unauthenticated');

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ApiError('invalid_credentials');
  }

  assertPasswordPolicy(input.newPassword, input.email);
  const newHash = await hashPassword(input.newPassword);

  await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, input.userId));

    await revokeUserSessions(tx, input.userId, 'password_changed', input.currentSessionId);

    // Nepoužité reset tokeny přestávají platit, jinak by šlo heslo hned přepsat zpět.
    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${input.userId}::uuid AND used_at IS NULL AND expires_at > now()
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_changed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  // Informační e-mail až po commitu: kdyby odešel uvnitř transakce, která se
  // pak rollbackne, uživatel dostane zprávu o změně, ke které nedošlo.
  await queueSystemMail({
    template: 'password_changed',
    to: input.email,
    locale: user.locale,
    data: { changed_at: new Date().toISOString() },
    userId: input.userId,
  });
}
