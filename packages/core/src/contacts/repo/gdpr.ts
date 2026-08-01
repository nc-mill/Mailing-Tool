import { sql } from 'drizzle-orm';
import { keyringFromEnv } from '@mlain/contracts/keyring';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { normalizeEmail } from '../email';
import { computeAllFingerprints, computeCurrentFingerprint } from '../fingerprint';
import {
  canTransition,
  computeDueAt,
  computeExtendedUntil,
  type GdprRequestStatus,
} from '../gdpr/request';
import type { GdprRequestType } from '../gdpr/request';
import { enqueue } from '../jobs/enqueue';
import { byteaArrayLiteral } from './bytea';

export type CreateGdprRequestInput = {
  email: string;
  type: GdprRequestType;
  mode?: 'anonymize' | 'purge';
  channel: 'preference_center' | 'admin' | 'api';
  requestedBy?: string;
};

/**
 * Založí žádost subjektu údajů.
 *
 * Plaintext adresy se v téhle tabulce NIKDY neukládá. Otisk se počítá stejným receptem
 * jako suppressions.fingerprint a ukládá se s pokolením klíče, kterým vznikl, aby šlo
 * žádosti téhož subjektu dohledat i po rotaci.
 *
 * Kanál rozhoduje o výchozím stavu: ze stránky předvoleb je totožnost prokázaná držením
 * podepsaného tokenu z e-mailu, který jsme sami odeslali, takže žádost jde rovnou
 * do processing. Z administrace a z API jde do verifying a čeká na potvrzení z e-mailu.
 */
export async function createGdprRequest(
  ctx: WorkspaceContext,
  input: CreateGdprRequestInput,
): Promise<{ id: string; status: GdprRequestStatus }> {
  const parsed = normalizeEmail(input.email);
  if (!parsed.ok) throw new ApiError('validation_failed', { params: { detail: parsed.code } });

  const keyring = keyringFromEnv();
  const { fingerprint, keyId } = computeCurrentFingerprint(keyring, parsed.email);
  const requestedAt = new Date();
  const status: GdprRequestStatus =
    input.channel === 'preference_center' ? 'processing' : 'verifying';

  return withWorkspace(ctx, async (tx) => {
    const contact = await tx.execute<{ id: string }>(sql`
      SELECT id FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${parsed.email}::citext
         AND deleted_at IS NULL
    `);

    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO gdpr_requests (workspace_id, contact_id, subject_email_fingerprint,
                                 subject_email_fingerprint_key_id, type, mode, status,
                                 channel, requested_at, due_at, verified_at, requested_by)
      VALUES (${ctx.workspaceId}::uuid,
              ${contact.rows[0]?.id ?? null}::uuid,
              ${fingerprint}, ${keyId}, ${input.type},
              ${input.type === 'erasure' ? (input.mode ?? 'anonymize') : null},
              ${status}, ${input.channel}, ${requestedAt}, ${computeDueAt(requestedAt)},
              ${status === 'processing' ? requestedAt : null},
              ${input.requestedBy ?? null})
      RETURNING id
    `);

    const id = inserted.rows[0]!.id;
    await writeAudit(tx, ctx, {
      action: 'gdpr.request_created',
      targetType: 'gdpr_request',
      targetId: id,
      // E-mail se do metadat auditu NEUKLÁDÁ, jen otisk.
      metadata: { type: input.type, channel: input.channel },
    });
    return { id, status };
  });
}

/**
 * Ruční ověření správcem. Žádost založená z administrace nebo přes API čeká, dokud
 * subjekt nepotvrdí kliknutím v e-mailu, který jsme poslali na jeho adresu.
 */
export async function verifyGdprRequest(ctx: WorkspaceContext, requestId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE gdpr_requests
         SET status = 'processing', verified_at = now()
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status IN ('received', 'verifying')
      RETURNING id
    `);
    if (result.rows.length === 0) {
      throw new ApiError('invalid_state_transition');
    }
  });
}

/**
 * Spuštění zpracování. Neověřená žádost se NIKDY neprovádí: jinak by stačilo znát
 * cizí adresu a nechat ji smazat, což je útok na cizí data.
 */
export async function processGdprRequest(ctx: WorkspaceContext, requestId: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const found = await tx.execute<{
      status: GdprRequestStatus;
      verified_at: Date | string | null;
      type: string;
      mode: string | null;
    }>(sql`
      SELECT status, verified_at, type, mode FROM gdpr_requests
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       FOR UPDATE
    `);
    if (found.rows.length === 0) throw new ApiError('not_found');

    const row = found.rows[0]!;

    if (row.status === 'completed' || row.status === 'rejected') {
      throw new ApiError('invalid_state_transition');
    }
    if (row.verified_at === null) {
      throw new ApiError('forbidden', { params: { detail: 'gdpr_not_verified' } });
    }
    if (!canTransition(row.status, 'processing') && row.status !== 'processing') {
      throw new ApiError('invalid_state_transition');
    }

    const queue =
      row.type === 'erasure'
        ? 'gdpr.erase'
        : row.type === 'access' || row.type === 'portability'
          ? 'gdpr.export_subject'
          : null;

    if (queue !== null) {
      await enqueue(tx, queue, { workspaceId: ctx.workspaceId, requestId });
    }
  });
}

/** Uzavření žádosti. Vyřízená žádost se dál nemění, hlídá to stavový automat. */
export async function completeGdprRequest(
  ctx: WorkspaceContext,
  requestId: string,
  affected: Record<string, unknown> = {},
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE gdpr_requests
         SET status = 'completed', completed_at = now(),
             affected = ${JSON.stringify(affected)}::jsonb,
             processed_by = ${ctx.actor.type === 'user' ? ctx.actor.userId : null}::uuid
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status NOT IN ('completed', 'rejected')
      RETURNING id
    `);
    if (result.rows.length === 0) throw new ApiError('invalid_state_transition');

    await writeAudit(tx, ctx, {
      action: 'gdpr.request_completed',
      targetType: 'gdpr_request',
      targetId: requestId,
      metadata: { affected },
    });
  });
}

/**
 * Dohledání všech žádostí téhož subjektu. Jde přes otisky pro všechna známá pokolení
 * klíče, protože plaintext v tabulce není a starší záznamy nesou starší pokolení.
 */
export async function findRequestsForSubject(
  ctx: WorkspaceContext,
  email: string,
): Promise<{ id: string; type: string; status: string }[]> {
  const parsed = normalizeEmail(email);
  if (!parsed.ok) return [];
  const keyring = keyringFromEnv();
  const fingerprints = computeAllFingerprints(keyring, parsed.email);

  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string; type: string; status: string }>(sql`
      SELECT id, type, status FROM gdpr_requests
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND subject_email_fingerprint = ANY(${byteaArrayLiteral(fingerprints)}::bytea[])
       ORDER BY created_at DESC
    `);
    return result.rows;
  });
}

/** Načte žádost i s režimem výmazu. Používá ji job výmazu a exportu. */
export async function getGdprRequest(
  ctx: WorkspaceContext,
  requestId: string,
): Promise<{
  id: string;
  contactId: string | null;
  type: GdprRequestType;
  mode: 'anonymize' | 'purge' | null;
  status: GdprRequestStatus;
} | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      contact_id: string | null;
      type: GdprRequestType;
      mode: 'anonymize' | 'purge' | null;
      status: GdprRequestStatus;
    }>(sql`
      SELECT id, contact_id, type, mode, status FROM gdpr_requests
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      contactId: row.contact_id,
      type: row.type,
      mode: row.mode,
      status: row.status,
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Seznam, prodloužení lhůty a zamítnutí (úkol 53).
 *
 * Seznam řadí podle lhůty vzestupně, protože sloupec se lhůtou je celý smysl
 * obrazovky: co je po termínu, musí být nahoře.
 * ------------------------------------------------------------------------- */

export type GdprRequestRecord = {
  id: string;
  contact_id: string | null;
  type: GdprRequestType;
  mode: 'anonymize' | 'purge' | null;
  status: GdprRequestStatus;
  channel: string;
  requested_at: Date | string;
  due_at: Date | string;
  extended_until: Date | string | null;
  completed_at: Date | string | null;
  rejection_reason: string | null;
};

const GDPR_COLUMNS = sql`id, contact_id, type, mode, status, channel, requested_at, due_at,
  extended_until, completed_at, rejection_reason`;

export async function listGdprRequests(
  ctx: WorkspaceContext,
  query: { limit: number; status?: string | undefined; type?: string | undefined },
): Promise<GdprRequestRecord[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<GdprRequestRecord>(sql`
      SELECT ${GDPR_COLUMNS} FROM gdpr_requests
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null})
         AND (${query.type ?? null}::text IS NULL OR type = ${query.type ?? null})
       ORDER BY due_at ASC
       LIMIT ${query.limit}
    `);
    return rows;
  });
}

export async function findGdprRequest(
  ctx: WorkspaceContext,
  requestId: string,
): Promise<GdprRequestRecord | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<GdprRequestRecord>(sql`
      SELECT ${GDPR_COLUMNS} FROM gdpr_requests
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${requestId}::uuid
    `);
    return rows[0] ?? null;
  });
}

/**
 * Prodloužení lhůty o dva měsíce podle čl. 12 odst. 3. Důvod je povinný, protože
 * prodloužení se musí dát obhájit před dozorovým úřadem, a prodloužit jde jen jednou:
 * druhé prodloužení už není prodloužení, ale nedodržení lhůty.
 */
export async function extendGdprRequest(
  ctx: WorkspaceContext,
  requestId: string,
  reason: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const found = await tx.execute<{ due_at: Date | string; extended_until: Date | string | null }>(
      sql`
      SELECT due_at, extended_until FROM gdpr_requests
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status IN ('received', 'verifying', 'processing')
       FOR UPDATE
    `,
    );
    const row = found.rows[0];
    if (row === undefined) throw new ApiError('not_found');
    if (row.extended_until !== null) throw new ApiError('invalid_state_transition');

    const dueAt = row.due_at instanceof Date ? row.due_at : new Date(row.due_at);
    const extendedUntil = computeExtendedUntil(dueAt);

    await tx.execute(sql`
      UPDATE gdpr_requests
         SET extended_until = ${extendedUntil}, extension_reason = ${reason}
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await writeAudit(tx, ctx, {
      action: 'gdpr.request_extended',
      targetType: 'gdpr_request',
      targetId: requestId,
      metadata: { extended_until: extendedUntil.toISOString(), reason },
    });
  });
}

/** Zamítnutí žádosti. Důvod je povinný ze stejného důvodu jako u prodloužení. */
export async function rejectGdprRequest(
  ctx: WorkspaceContext,
  requestId: string,
  reason: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE gdpr_requests
         SET status = 'rejected', rejection_reason = ${reason}, completed_at = now(),
             processed_by = ${ctx.actor.type === 'user' ? ctx.actor.userId : null}::uuid
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status NOT IN ('completed', 'rejected')
      RETURNING id
    `);
    if (result.rows.length === 0) throw new ApiError('invalid_state_transition');
    await writeAudit(tx, ctx, {
      action: 'gdpr.request_rejected',
      targetType: 'gdpr_request',
      targetId: requestId,
      metadata: { reason },
    });
  });
}
