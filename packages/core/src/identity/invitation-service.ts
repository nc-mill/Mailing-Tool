import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withUser, withWorkspace, type Tx } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { queueSystemMail } from '../platform/system-mail';
import { getSystemMailStatus } from '../platform/system-mail-config';
import { createInvitationContext } from './context';
import { generateOpaqueToken, tokenHash } from './token';
import { IdentityAuditActions } from './audit';
import { wsEq } from './scope';
import type { Role, WorkspaceContext } from './types';

/**
 * ODCHYLKA OD PLÁNU: konfigurace se čte líně, protože P01 vydává jen
 * `loadConfig()`. Stejný vzor jako v `session.ts` a `tx/index.ts`.
 */
let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/** 3.3: platnost 7 dní, jednorázová, nejvýš 100 čekajících na workspace. */
export const INVITATION_TTL_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 100;

let lastToken: string | null = null;

/** Jen pro testy. V provozu token odchází pouze e-mailem a nikde se neuchovává. */
export function __lastInvitationTokenForTests(): string | null {
  return lastToken;
}

export type PublicInvitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
};

export async function listInvitations(tx: Tx, ctx: WorkspaceContext): Promise<PublicInvitation[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, email::text AS email, role, expires_at, created_at
      FROM invitations
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as Role,
    expires_at: new Date(r.expires_at as Date).toISOString(),
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

export async function createInvitation(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { email: string; role: Role },
  actorLabel: string,
): Promise<PublicInvitation> {
  const email = input.email.trim().toLowerCase();

  /**
   * POZVÁNKA SE NEZALOŽÍ, KDYŽ NENÍ ČÍM JI ODESLAT.
   *
   * Kontroluje se to PŘED zápisem, ne až podle výsledku odeslání, a je to
   * rozdíl, který uživatel vidí. Dřív vznikl řádek v `invitations`, obrazovka
   * ukázala „čeká na přijetí" a e-mail nikam neodešel; pozvaný člověk se to
   * nedozvěděl nikdy a zvoucí se to dozvěděl leda z logu. Instalace s jediným
   * odesílacím účtem typu SES je přesně v tomhle stavu, protože systémovou poštu
   * odsud odešle jen účet typu SMTP.
   *
   * Platí to i mimo produkci. Záchranná větev v `queueSystemMail`, která odkaz
   * mimo produkci dopíše do logu, je pomůcka pro vývoj, ne způsob doručení:
   * uživatel vývojové instalace čeká na e-mail zrovna tak.
   *
   * Náhradní cesta existuje a je v téže obrazovce: založit člena rovnou s heslem
   * (`member-create.ts`). Proto se tu nic neobchází, jen se nesmí slibovat
   * doručení, které se nestane.
   */
  const mail = await getSystemMailStatus(tx, ctx.workspaceId, cfg().APP_URL);
  if (!mail.available) {
    throw new ApiError('system_mail_unavailable', {
      params: { reason: mail.reason, provider_type: mail.provider_type },
    });
  }

  const { rows: member } = await tx.execute(sql`
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND u.email = ${email} AND u.deleted_at IS NULL
     LIMIT 1
  `);
  if (member.length > 0) throw new ApiError('conflict', { params: { reason: 'already_member' } });

  const { rows: pending } = await tx.execute<{ c: string }>(sql`
    SELECT count(*) AS c FROM invitations
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `);
  if (Number(pending[0]!.c) >= MAX_PENDING_INVITATIONS) {
    throw new ApiError('conflict', { params: { reason: 'too_many_pending_invitations' } });
  }

  // 3.3: opakované pozvání téhož e-mailu revokuje předchozí čekající pozvánku.
  // Bez toho by unikátní částečný index uq_invitations__ws_email_pending zápis odmítl.
  await tx.execute(sql`
    UPDATE invitations SET revoked_at = now()
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}
       AND accepted_at IS NULL AND revoked_at IS NULL
  `);

  const token = generateOpaqueToken();
  lastToken = token;

  const [row] = await tx
    .insert(schema.invitations)
    .values({
      workspaceId: ctx.workspaceId,
      email,
      role: input.role,
      tokenHash: tokenHash(token),
      invitedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      expiresAt: sql`now() + interval '${sql.raw(String(INVITATION_TTL_DAYS))} days'`,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.invited'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'invitation',
    targetId: row!.id,
    metadata: { email, role: input.role },
  });

  await queueSystemMail({
    template: 'invitation',
    to: email,
    locale: cfg().DEFAULT_LOCALE,
    data: { url: `${cfg().APP_URL}/invitations/accept?token=${token}` },
    workspaceId: ctx.workspaceId,
  });

  return {
    id: row!.id,
    email,
    role: input.role,
    expires_at: new Date(row!.expiresAt).toISOString(),
    created_at: new Date(row!.createdAt).toISOString(),
  };
}

export async function revokeInvitation(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  const revoked = await tx
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        wsEq(ctx, schema.invitations),
        eq(schema.invitations.id, id),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    )
    .returning({ id: schema.invitations.id });
  if (revoked.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.invitation_revoked'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'invitation',
    targetId: id,
  });
}

/**
 * 3.3: přijetí přihlášeným uživatelem s jiným e-mailem je povolené, pozvánka
 * váže roli, ne identitu. Do auditu se zapíše obojí.
 *
 * Neplatný, prošlý, revokovaný i už použitý token vrací shodně 404, aby z reakce
 * nešlo zjistit, jestli pozvánka existuje.
 */
export async function acceptInvitation(input: {
  userId: string;
  userEmail: string;
  token: string;
}): Promise<{ workspace: { id: string; name: string; slug: string }; role: Role }> {
  const hash = tokenHash(input.token);

  // ODCHYLKA OD PLÁNU, vynucená politikami P03 a ověřená spuštěním. Plán tady
  // spojoval `invitations` s `workspaces` v JEDNÉ transakci pod `withUser`.
  // Takový dotaz vrátí VŽDY nula řádků: pozvánku pustí politika
  // `invitation_token_lookup`, jenže projekt v téže transakci vidí jen
  // `ws_member_visibility`, a ta chce členství, které teprve vzniká. Přijímající
  // uživatel členem není, takže JOIN nic nespáruje a `acceptInvitation` skončí
  // na 404 i s platným tokenem. Migrace 0004 to u politiky výslovně popisuje
  // a odkazuje na druhou transakci; obdoba `ws_api_key_lookup` pro workspaces
  // tam ZÁMĚRNĚ není, protože by každý přihlášený uživatel viděl ve výpisu
  // cizí projekt s otevřenou pozvánkou.
  //
  // Název a slug projektu se proto čtou až ve DRUHÉ transakci, která už má
  // workspace kontext z pozvánky, a pustí je `ws_isolation_self`.
  const found = await withUser(input.userId, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, workspace_id::text AS workspace_id, role, email::text AS email
        FROM invitations
       WHERE token_hash = ${hash}
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
  if (!found) throw new ApiError('not_found');

  const workspaceId = found.workspace_id as string;
  const role = found.role as Role;

  // Kontext se vyrábí z pozvánky, ne z requestu: workspace_id pochází z řádku
  // dohledaného podle token_hash. Členství se ověřovat nedá, teprve vzniká,
  // takže aktérem je přijímající uživatel s rolí, kterou pozvánka nese.
  const acceptCtx = createInvitationContext(workspaceId, input.userId, role);

  return withWorkspace(acceptCtx, async (tx) => {
    // Smazaný projekt se kontroluje tady, ne v prvním dotazu: teprve v téhle
    // transakci je řádek `workspaces` vůbec viditelný.
    const { rows: workspaces } = await tx.execute<{ name: string; slug: string }>(sql`
      SELECT name, slug FROM workspaces
       WHERE id = ${workspaceId}::uuid AND deleted_at IS NULL
       LIMIT 1
    `);
    const workspace = workspaces[0];
    if (!workspace) throw new ApiError('not_found');

    const { rows: accepted } = await tx.execute(sql`
      UPDATE invitations SET accepted_at = now(), accepted_by = ${input.userId}::uuid
       WHERE id = ${found.id as string}::uuid AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id
    `);
    // Souběžné druhé přijetí tady skončí na nule řádků a transakce se rollbackne.
    if (accepted.length !== 1) throw new ApiError('not_found');

    await tx.execute(sql`
      INSERT INTO memberships (workspace_id, user_id, role)
      VALUES (${workspaceId}::uuid, ${input.userId}::uuid, ${role})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['member.joined'],
      workspaceId,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.userEmail },
      targetType: 'invitation',
      targetId: found.id as string,
      metadata: { invited_email: found.email as string, accepted_email: input.userEmail, role },
    });

    return {
      workspace: { id: workspaceId, name: workspace.name, slug: workspace.slug },
      role,
    };
  });
}
