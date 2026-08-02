import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createPool, withoutContext } from '@mlain/db';
import { writeAuditLog } from '../audit/write';
import { hashPassword } from '../identity/password';
import { OPS_AUDIT_ACTIONS } from './audit';

export const MIN_PASSWORD_LENGTH = 10;

export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`Uživatel s adresou ${email} v instalaci není.`);
    this.name = 'UserNotFoundError';
  }
}

export type ResetPasswordInput = {
  /**
   * Aplikační URL stačí. `users` i `sessions` jsou na whitelistu tabulek
   * BEZ row level security (P03), takže jako jediný z osmi příkazů nepotřebuje
   * migrátora. Je to záměr: obnova hesla musí jít i v instalaci, kde
   * `DATABASE_URL_MIGRATOR` nikdo nenastavil.
   */
  databaseUrl: string;
  email: string;
  /** Když je null, vygeneruje se heslo a vypíše se na stdout. */
  password: string | null;
};

export type ResetPasswordReport = { userId: string; generatedPassword: string | null };

export async function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordReport> {
  const generated = input.password === null ? randomBytes(18).toString('base64url') : null;
  const password = input.password ?? generated!;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků. Žádné speciální znaky se nevyžadují, délka je jediný požadavek.`,
    );
  }

  const pool = createPool(input.databaseUrl, 'app', 1);
  try {
    return await withoutContext(pool, async (tx) => {
      // `users.email` je citext, takže lower() na obou stranách je zbytečné
      // a hlavně by zahodilo použití unikátního indexu. Porovnává se přímo.
      const { rows: users } = await tx.execute<{ id: string }>(
        sql`SELECT id FROM users WHERE email = ${input.email} AND deleted_at IS NULL`,
      );
      const user = users[0];
      if (!user) throw new UserNotFoundError(input.email);

      // Sloupec se jmenuje `failed_login_count`, ne `failed_login_attempts`.
      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${await hashPassword(password)},
               password_changed_at = now(),
               failed_login_count = 0,
               locked_until = NULL,
               updated_at = now()
         WHERE id = ${user.id}`);
      // Změna hesla revokuje všechny relace, stejně jako změna z rozhraní.
      await tx.execute(sql`
        UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
         WHERE user_id = ${user.id} AND revoked_at IS NULL`);
      await writeAuditLog(tx, {
        action: OPS_AUDIT_ACTIONS['user.password_reset_from_cli'],
        workspaceId: null,
        actor: { actorType: 'system', actorId: null, actorLabel: 'mlain reset-password' },
        targetType: 'user',
        targetId: user.id,
        metadata: { generated: generated !== null },
      });
      return { userId: user.id, generatedPassword: generated };
    });
  } finally {
    await pool.end();
  }
}
