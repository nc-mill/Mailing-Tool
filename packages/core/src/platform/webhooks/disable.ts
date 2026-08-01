import { sql } from 'drizzle-orm';
import { withWorkspace } from '../../tx';
import { writeAuditLog } from '../../audit/write';
import { createSystemContext } from '../../identity/context';
import { IdentityAuditActions } from '../../identity/audit';
import type { WorkspaceContext } from '../../identity/types';
import { queueSystemMail } from '../system-mail';

/** 3.8: consecutive_failures >= 20 endpoint deaktivuje. */
export const DISABLE_AFTER_FAILURES = 20;
/** Nebo žádné úspěšné doručení posledních 72 hodin při aspoň 10 pokusech. */
export const DISABLE_NO_SUCCESS_HOURS = 72;
export const DISABLE_NO_SUCCESS_MIN_ATTEMPTS = 10;
export const SNIPPET_LIMIT = 2 * 1024;

/** Jméno jobu, pod kterým se zapisuje systémový aktér do audit logu. */
export const DELIVER_JOB = 'platform.webhook_deliver';

export type DisableReason = 'too_many_failures' | 'no_success_72h' | 'endpoint_gone';

export function shouldDisable(input: {
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  attemptsSinceSuccess: number;
}): DisableReason | null {
  if (input.consecutiveFailures >= DISABLE_AFTER_FAILURES) return 'too_many_failures';
  if (input.attemptsSinceSuccess >= DISABLE_NO_SUCCESS_MIN_ATTEMPTS) {
    const cutoff = Date.now() - DISABLE_NO_SUCCESS_HOURS * 60 * 60 * 1000;
    const noSuccess =
      input.lastSuccessAt === null || new Date(input.lastSuccessAt).getTime() < cutoff;
    if (noSuccess) return 'no_success_72h';
  }
  return null;
}

export type DeliveryOutcomeInput = {
  workspaceId: string;
  deliveryId: string;
  createdAt: Date;
  endpointId: string;
  attempt: number;
  status: 'succeeded' | 'failed' | 'abandoned';
  responseStatus: number | null;
  snippet: string | null;
  durationMs: number | null;
  errorCode: string | null;
  nextAttemptAt: Date | null;
  disableReason: string | null;
};

/**
 * Zápis výsledku jednoho pokusu. Čítač neúspěchů se zvyšuje za KAŽDÝ pokus,
 * ne za doručení: hláška v UI slibuje vypnutí "po 20 neúspěšných pokusech"
 * a kritérium 40 měří totéž.
 *
 * ODCHYLKA OD PLÁNU: plán volal `withWorkspace(input.workspaceId, ...)`, tedy
 * předával řetězec tam, kde obálka podle rozhodnutí R2 bere `WorkspaceContext`.
 * Neprojde to typovou kontrolou a hlavně by to obcházelo první vrstvu izolace.
 * Zápis běží z jobu, takže kontext je systémový a vyrábí ho `createSystemContext`,
 * což je pro tenhle případ určená a jediná legitimní cesta.
 */
export async function applyDeliveryOutcome(input: DeliveryOutcomeInput): Promise<void> {
  const ctx = createSystemContext(input.workspaceId, DELIVER_JOB);
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE webhook_deliveries
         SET status = ${input.status},
             attempt = ${input.attempt},
             next_attempt_at = ${input.nextAttemptAt},
             response_status = ${input.responseStatus},
             response_body_snippet = ${input.snippet === null ? null : input.snippet.slice(0, SNIPPET_LIMIT)},
             duration_ms = ${input.durationMs},
             error_code = ${input.errorCode},
             delivered_at = ${input.status === 'succeeded' ? new Date() : null}
       WHERE id = ${input.deliveryId}::uuid AND created_at = ${input.createdAt}
    `);

    if (input.status === 'succeeded') {
      await tx.execute(sql`
        UPDATE webhook_endpoints
           SET consecutive_failures = 0, last_success_at = now(), updated_at = now()
         WHERE id = ${input.endpointId}::uuid
      `);
      return;
    }

    const { rows } = await tx.execute<{
      consecutive_failures: number;
      last_success_at: Date | null;
      status: string;
    }>(sql`
      UPDATE webhook_endpoints
         SET consecutive_failures = consecutive_failures + 1,
             last_failure_at = now(),
             updated_at = now()
       WHERE id = ${input.endpointId}::uuid
       RETURNING consecutive_failures, last_success_at, status
    `);
    const endpoint = rows[0];
    if (!endpoint) return;

    const reason =
      (input.disableReason as DisableReason | null) ??
      shouldDisable({
        consecutiveFailures: endpoint.consecutive_failures,
        lastSuccessAt: endpoint.last_success_at,
        attemptsSinceSuccess: endpoint.consecutive_failures,
      });

    if (!reason || endpoint.status === 'disabled') return;

    await tx.execute(sql`
      UPDATE webhook_endpoints
         SET status = 'disabled', disabled_reason = ${reason}, disabled_at = now(), updated_at = now()
       WHERE id = ${input.endpointId}::uuid
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['webhook_endpoint.disabled'],
      workspaceId: input.workspaceId,
      actor: { actorType: 'system', actorId: null, actorLabel: DELIVER_JOB },
      targetType: 'webhook_endpoint',
      targetId: input.endpointId,
      metadata: { reason, consecutive_failures: endpoint.consecutive_failures },
    });

    // 3.8: e-mail všem uživatelům s rolí owner a admin.
    const { rows: recipients } = await tx.execute<{ email: string; locale: string }>(sql`
      SELECT u.email::text AS email, u.locale AS locale
        FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ${input.workspaceId}::uuid
         AND m.role IN ('owner','admin') AND u.deleted_at IS NULL
    `);

    for (const recipient of recipients) {
      await queueSystemMail({
        template: 'webhook_endpoint_disabled',
        to: recipient.email,
        locale: recipient.locale,
        data: { endpoint_id: input.endpointId, reason },
      });
    }
  });
}

/** Znovuaktivace vynuluje čítač. Přehrání posledních 24 hodin nabízí UI (P06). */
export async function enableEndpoint(ctx: WorkspaceContext, endpointId: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute(sql`
      UPDATE webhook_endpoints
         SET status = 'active', disabled_reason = NULL, disabled_at = NULL,
             consecutive_failures = 0, updated_at = now()
       WHERE id = ${endpointId}::uuid AND deleted_at IS NULL
       RETURNING id
    `);
    return rows.length === 1;
  });
}
