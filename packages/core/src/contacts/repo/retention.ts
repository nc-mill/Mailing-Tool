import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { RETENTION_DEFAULTS, RETENTION_TARGETS, type RetentionTarget } from '../retention/registry';

/**
 * Politiky retence v databázi.
 *
 * Registr cílů a jejich handlery vlastní `retention/registry.ts`; tenhle soubor
 * je jen čte a zapisuje, aby doména nemusela sahat do tabulky z jobu i z API dvěma
 * různými dotazy.
 */

export type RetentionPolicyRow = {
  target: RetentionTarget;
  retain_days: number;
  action: 'delete' | 'anonymize';
  enabled: boolean;
  last_run_at: Date | string | null;
};

export async function listRetentionPolicies(ctx: WorkspaceContext): Promise<RetentionPolicyRow[]> {
  const stored = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<RetentionPolicyRow>(sql`
      SELECT target, retain_days, action, enabled, last_run_at
        FROM retention_policies
       WHERE workspace_id = ${ctx.workspaceId}::uuid
       ORDER BY target
    `);
    return rows;
  });

  // Projekt bez uložené politiky není projekt bez retence: platí výchozí hodnoty
  // z registru. Kdyby se vracel prázdný seznam, obrazovka by tvrdila, že se nemaže nic.
  const byTarget = new Map(stored.map((row) => [row.target, row]));
  return RETENTION_TARGETS.map((target) => {
    const row = byTarget.get(target);
    if (row !== undefined) return row;
    const fallback = RETENTION_DEFAULTS[target];
    return {
      target,
      retain_days: fallback.days,
      action: fallback.action,
      enabled: fallback.enabled,
      last_run_at: null,
    };
  });
}

export type RetentionPolicyInput = {
  target: RetentionTarget;
  retain_days: number;
  action: 'delete' | 'anonymize';
  enabled: boolean;
};

/**
 * Odhad dopadu první změny politiky. Vrací počet řádků, které by první běh smazal,
 * a jejich podíl na celku. Nad desetinou se od uživatele žádá potvrzení: špatně
 * nastavená retence maže data, která sbíral roky, a UNDO na to není.
 */
export async function estimateRetentionImpact(
  ctx: WorkspaceContext,
  policies: readonly RetentionPolicyInput[],
): Promise<{ rows: number; total: number; ratio: number }> {
  // Odhaduje se jen nad tabulkami, které tahle doména skutečně uklízí. Cíle se soubory
  // (import_files, exports) vlastní P11 a jejich řádky se počítají v jeho tabulkách.
  const TABLES: Partial<Record<RetentionTarget, { table: string; column: string }>> = {
    import_errors: { table: 'import_errors', column: 'created_at' },
    form_submissions: { table: 'form_submissions', column: 'created_at' },
    inbound_deliveries: { table: 'inbound_deliveries', column: 'created_at' },
    unconfirmed_subscriptions: { table: 'list_subscriptions', column: 'subscribed_at' },
    inactive_contacts: { table: 'contacts', column: 'created_at' },
  };

  let affected = 0;
  let total = 0;

  await withWorkspace(ctx, async (tx) => {
    for (const policy of policies) {
      if (!policy.enabled) continue;
      const mapping = TABLES[policy.target];
      if (mapping === undefined) continue;

      const { rows } = await tx.execute<{ affected: number; total: number }>(sql`
        SELECT
          count(*) FILTER (
            WHERE ${sql.raw(mapping.column)} < now() - make_interval(days => ${policy.retain_days})
          )::int AS affected,
          count(*)::int AS total
          FROM ${sql.raw(mapping.table)}
         WHERE workspace_id = ${ctx.workspaceId}::uuid
      `);
      affected += rows[0]?.affected ?? 0;
      total += rows[0]?.total ?? 0;
    }
  });

  return { rows: affected, total, ratio: total === 0 ? 0 : affected / total };
}

export async function saveRetentionPolicies(
  ctx: WorkspaceContext,
  policies: readonly RetentionPolicyInput[],
): Promise<void> {
  if (policies.length === 0) return;
  await withWorkspace(ctx, async (tx) => {
    for (const policy of policies) {
      // Minimum je jeden den a hlídá ho i `ck_retention_policies__retain_days`.
      // Kontrola tady je proto, aby uživatel dostal validation_failed a ne internal_error.
      if (policy.retain_days < 1 || policy.retain_days > 3650) {
        throw new ApiError('validation_failed', {
          errors: [
            {
              path: 'policies',
              code: 'retention_below_minimum',
              message: 'Doba uchování musí být 1 až 3650 dnů.',
            },
          ],
        });
      }
      await tx.execute(sql`
        INSERT INTO retention_policies (workspace_id, target, retain_days, action, enabled)
        VALUES (${ctx.workspaceId}::uuid, ${policy.target}, ${policy.retain_days},
                ${policy.action}, ${policy.enabled})
        ON CONFLICT (workspace_id, target) DO UPDATE SET
          retain_days = excluded.retain_days,
          action = excluded.action,
          enabled = excluded.enabled,
          updated_at = now()
      `);
    }
    await writeAudit(tx, ctx, {
      action: 'retention.policy_changed',
      targetType: 'retention_policy',
      targetId: ctx.workspaceId,
      metadata: {
        policies: policies.map((p) => ({ target: p.target, retain_days: p.retain_days })),
      },
    });
  });
}
