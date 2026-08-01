import { withWorkspace, type WorkspaceContext } from '../../tx';
// Jediná kopie `rawSql`, viz poznámka v `provider.ts`.
import { rawSql } from '../../campaigns/repo/raw-sql';

export type DomainRow = {
  id: string;
  workspace_id: string;
  provider_id: string;
  domain: string;
  dkim_tokens: string[];
  dkim_hosted_zone: string | null;
  dkim_status: string;
  mail_from_subdomain: string | null;
  mail_from_status: string;
  spf_ok: boolean | null;
  dkim_ok: boolean | null;
  dmarc_ok: boolean | null;
  mx_ok: boolean | null;
  checks: unknown;
  checked_at: string | null;
  next_check_at: string | null;
  ses_verification_status: string | null;
  verified_at: string | null;
};

export type SaveChecksInput = {
  checks: unknown;
  spf: boolean | null;
  dkim: boolean | null;
  dmarc: boolean | null;
  mx: boolean | null;
  nextCheckSeconds: number;
};

export async function saveChecks(
  ctx: WorkspaceContext,
  id: string,
  input: SaveChecksInput,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE sender_domains
          SET checks = $3::jsonb, spf_ok = $4, dkim_ok = $5, dmarc_ok = $6, mx_ok = $7,
              checked_at = now(), next_check_at = now() + ($8 || ' seconds')::interval,
              verified_at = CASE WHEN $5 AND $4 THEN COALESCE(verified_at, now()) ELSE verified_at END,
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
        [
          id,
          ctx.workspaceId,
          JSON.stringify(input.checks),
          input.spf,
          input.dkim,
          input.dmarc,
          input.mx,
          String(input.nextCheckSeconds),
        ],
      ),
    );
  });
}

export async function listDue(ctx: WorkspaceContext, limit: number): Promise<DomainRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(
      rawSql(
        `SELECT * FROM sender_domains
        WHERE workspace_id = $1 AND next_check_at IS NOT NULL AND next_check_at <= now()
        ORDER BY next_check_at
        LIMIT ${Number(limit)}`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}

export async function getDomain(ctx: WorkspaceContext, id: string): Promise<DomainRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(
      rawSql(`SELECT * FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0] ?? null;
  });
}
