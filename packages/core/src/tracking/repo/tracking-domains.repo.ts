import { sql } from 'drizzle-orm';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { withCrossWorkspaceTx, withTrackingTx } from './tx';

export type TrackingDomainRow = {
  id: string;
  workspaceId: string;
  host: string;
  includeSubdomains: boolean;
};

/**
 * Načte celou tabulku. Řádově tisíce řádků na celou instalaci.
 *
 * Je to jedno z vyjmenovaných míst, která sahají napříč projekty. Dokud P03
 * nedodá mechanismus systémového přístupu, vrátí nula řádků a nevrátí chybu,
 * viz komentář u `withCrossWorkspaceTx`.
 */
export async function selectAllTrackingDomains(): Promise<TrackingDomainRow[]> {
  return withCrossWorkspaceTx(
    'tracking.domain_cache',
    async (tx) =>
      (
        await tx.execute<TrackingDomainRow>(sql`
          SELECT id, workspace_id AS "workspaceId", host,
                 include_subdomains AS "includeSubdomains"
            FROM tracking_domains
        `)
      ).rows,
  );
}

export type TrackingDomainDetailRow = TrackingDomainRow & {
  verifiedAt: Date | null;
  createdAt: Date;
};

export async function selectTrackingDomains(
  ctx: WorkspaceContext,
): Promise<TrackingDomainDetailRow[]> {
  return withWorkspace(
    ctx,
    async (tx) =>
      (
        await tx.execute<TrackingDomainDetailRow>(sql`
          SELECT id, workspace_id AS "workspaceId", host,
                 include_subdomains AS "includeSubdomains",
                 verified_at AS "verifiedAt", created_at AS "createdAt"
            FROM tracking_domains
           ORDER BY host
        `)
      ).rows,
  );
}

export async function countTrackingDomains(ctx: WorkspaceContext): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ count: string }>(
      sql`SELECT count(*) FROM tracking_domains`,
    );
    return Number(rows[0]?.count ?? 0);
  });
}

export async function insertTrackingDomain(
  ctx: WorkspaceContext,
  input: { id: string; host: string; includeSubdomains: boolean },
): Promise<TrackingDomainRow> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<TrackingDomainRow>(sql`
      INSERT INTO tracking_domains (id, workspace_id, host, include_subdomains)
      VALUES (${input.id}, ${ctx.workspaceId}, ${input.host}, ${input.includeSubdomains})
      RETURNING id, workspace_id AS "workspaceId", host,
                include_subdomains AS "includeSubdomains"
    `);
    return rows[0]!;
  });
}

export async function deleteTrackingDomain(ctx: WorkspaceContext, id: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`DELETE FROM tracking_domains WHERE id = ${id} RETURNING id`,
    );
    return rows.length > 0;
  });
}

/** Projekt a host, jehož ověření se zapisuje. Pojmenovaný typ kvůli `scope.test.ts`. */
export type TrackingDomainVerification = { workspaceId: string; host: string };

export async function markTrackingDomainVerified(
  target: TrackingDomainVerification,
): Promise<void> {
  await withTrackingTx(
    { workspaceId: target.workspaceId, job: 'tracking.domain_verify' },
    async (tx) => {
      await tx.execute(sql`
        UPDATE tracking_domains SET verified_at = now()
         WHERE workspace_id = ${target.workspaceId}
           AND host = ${target.host}
           AND verified_at IS NULL
      `);
    },
  );
}
