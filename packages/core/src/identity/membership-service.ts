import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../tx';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { IdentityAuditActions } from './audit';
import { wsEq } from './scope';
import type { Role, WorkspaceContext } from './types';

export type MemberRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
};

export async function listMembers(tx: Tx, ctx: WorkspaceContext): Promise<MemberRow[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.user_id::text AS user_id, u.email::text AS email, u.name AS name,
           m.role AS role, m.created_at AS created_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND u.deleted_at IS NULL
     ORDER BY m.created_at
  `);
  return rows.map((r) => ({
    user_id: r.user_id as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as Role,
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

/**
 * 3.3, invariant 1: každý workspace má právě jednoho ownera. Vynucuje se
 * v aplikační transakci, ne indexem, protože při předání vlastnictví musí
 * na okamžik existovat dva a index by to zablokoval.
 *
 * SMAZANÍ UŽIVATELÉ SE NEPOČÍTAJÍ, ani mezi vlastníky, ani jako cíl. Členství
 * po měkce smazaném účtu zůstává (viz `user-delete.ts`), a bez tohohle spojení
 * s `users` by se počítalo jako plnohodnotný vlastník: projekt by měl podle
 * čísla dva vlastníky, `listMembers` by ukázal jednoho, a odebrat toho živého
 * by šlo, protože „druhý přece zůstane". Duch by přitom neexistoval a projekt
 * by zůstal bez vlastníka. Táž podmínka je i v `listMembers`.
 */
async function assertNotLastOwner(tx: Tx, ctx: WorkspaceContext, userId: string): Promise<void> {
  const { rows } = await tx.execute<{ owners: string; role: string | null }>(sql`
    SELECT (SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND m.role = 'owner'
               AND u.deleted_at IS NULL) AS owners,
           (SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND m.user_id = ${userId}::uuid
               AND u.deleted_at IS NULL) AS role
  `);
  const row = rows[0];
  if (!row || row.role === null) throw new ApiError('not_found');
  if (row.role === 'owner' && Number(row.owners) <= 1) {
    throw new ApiError('last_owner_cannot_be_removed');
  }
}

export async function changeMemberRole(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { userId: string; role: Role },
  actorLabel: string,
): Promise<MemberRow> {
  if (input.role !== 'owner') await assertNotLastOwner(tx, ctx, input.userId);

  const updated = await tx
    .update(schema.memberships)
    .set({ role: input.role, updatedAt: new Date() })
    .where(and(wsEq(ctx, schema.memberships), eq(schema.memberships.userId, input.userId)))
    .returning({ userId: schema.memberships.userId });
  if (updated.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.role_changed'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: input.userId,
    metadata: { role: input.role },
  });

  const members = await listMembers(tx, ctx);
  const member = members.find((m) => m.user_id === input.userId);
  if (!member) throw new ApiError('not_found');
  return member;
}

export async function removeMember(
  tx: Tx,
  ctx: WorkspaceContext,
  userId: string,
  actorLabel: string,
): Promise<void> {
  await assertNotLastOwner(tx, ctx, userId);
  const removed = await tx
    .delete(schema.memberships)
    .where(and(wsEq(ctx, schema.memberships), eq(schema.memberships.userId, userId)))
    .returning({ userId: schema.memberships.userId });
  if (removed.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.removed'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: userId,
  });
}
