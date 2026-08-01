import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import {
  RETENTION_DEFAULTS,
  RETENTION_TARGETS,
  getHandler,
  type RetentionPolicy,
  type RetentionTarget,
} from '../retention/registry';
// Import kvůli vedlejšímu efektu: soubor registruje pět handlerů této domény.
import '../retention/handlers';

export type RetentionRunPayload = { workspaceId: string };

/** Tvrdý strop jednoho běhu. Když se nestihne, pokračuje se další noc. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Načte politiky projektu a doplní chybějící z výchozích hodnot.
 *
 * TADY SE POTKÁVAJÍ DVA NÁZVY TÉŽE VĚCI. Sloupec ve schématu se jmenuje `retain_days`,
 * doménový typ `RetentionPolicy` má pole `days`. Mapování je jednosměrné a děje se
 * výhradně tady. Bez něj by byl `policy.days` `undefined` a interval by skončil chybou,
 * tedy retence by spadla na prvním cíli, každou noc.
 */
async function loadPolicies(
  ctx: WorkspaceContext,
): Promise<Record<RetentionTarget, RetentionPolicy>> {
  const rows = await withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{
      target: RetentionTarget;
      retain_days: number;
      action: 'delete' | 'anonymize';
      enabled: boolean;
    }>(sql`
      SELECT target, retain_days, action, enabled
        FROM retention_policies
       WHERE workspace_id = ${ctx.workspaceId}::uuid
    `);
    return result.rows;
  });

  const result = { ...RETENTION_DEFAULTS };
  for (const row of rows) {
    result[row.target] = {
      days: Number(row.retain_days),
      action: row.action,
      enabled: row.enabled,
    };
  }
  return result;
}

/**
 * Denní retenční běh jednoho projektu. Spouští ho cron s rozprostřením v čase
 * (offset odvozený z hashe workspace_id), aby se sto projektů nespustilo v jednu sekundu,
 * a se singletonKey rovným workspace_id.
 *
 * Idempotentní: mazání podle stáří je idempotentní z definice a běh se zaznamenává
 * do retention_runs, takže druhý běh po pádu jen dokončí, co první nestihl.
 *
 * BĚŽÍ POD KONTEXTEM PROJEKTU. Tabulky téhle domény mají politiku `ws_isolation`
 * a `maintenance_bypass` má jediná tabulka, `web_events`, kterou retence kontaktů
 * neuklízí. Bez kontextu by každý DELETE ovlivnil nula řádků a NEVRÁTIL CHYBU, takže
 * by job hlásil úspěch a osobní údaje by v databázi zůstaly.
 */
export async function runRetention(
  payload: RetentionRunPayload,
): Promise<{ status: 'completed' | 'partial' | 'failed' }> {
  const ctx = createSystemContext(payload.workspaceId, 'retention.run');
  const startedAt = Date.now();
  const policies = await loadPolicies(ctx);
  let status: 'completed' | 'partial' | 'failed' = 'completed';

  for (const target of RETENTION_TARGETS) {
    const policy = policies[target];
    if (!policy.enabled) continue;

    const runId = await withWorkspace(ctx, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO retention_runs (workspace_id, target, status)
        VALUES (${ctx.workspaceId}::uuid, ${target}, 'running')
        RETURNING id
      `);
      return rows[0]!.id;
    });

    const handler = getHandler(target);
    if (handler === undefined) {
      // Chybějící handler cíl PŘESKOČÍ, nezastaví běh. Dva cíle vyžadují úložiště
      // souborů, které dodává plán P11; do té doby se zaznamená důvod a pokračuje se.
      await finish(ctx, runId, {
        status: 'partial',
        errorDetail: `handler pro cíl ${target} není registrovaný`,
      });
      status = 'partial';
      continue;
    }

    try {
      const result = await handler({ ctx, policy });
      await finish(ctx, runId, {
        status: Date.now() - startedAt > RUN_TIMEOUT_MS ? 'partial' : 'completed',
        scanned: result.scanned,
        affected: result.affected,
      });
    } catch (error) {
      await finish(ctx, runId, { status: 'failed', errorDetail: String(error) });
      status = 'failed';
    }

    if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
      status = 'partial';
      break;
    }
  }

  return { status };
}

async function finish(
  ctx: WorkspaceContext,
  runId: string,
  input: {
    status: 'completed' | 'partial' | 'failed';
    scanned?: number;
    affected?: number;
    errorDetail?: string;
  },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE retention_runs
         SET status = ${input.status}, finished_at = now(),
             scanned = ${input.scanned ?? 0}, affected = ${input.affected ?? 0},
             error_detail = ${input.errorDetail ?? null}
       WHERE id = ${runId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  });
}
