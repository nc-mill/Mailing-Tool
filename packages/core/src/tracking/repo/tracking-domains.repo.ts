import { sql } from 'drizzle-orm';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { withTrackingTx } from './tx';

export type TrackingDomainRow = {
  id: string;
  workspaceId: string;
  host: string;
  includeSubdomains: boolean;
};

/** Host a to, jestli pravidlo platí i na jeho subdomény. */
export type AllowedOrigin = { host: string; includeSubdomains: boolean };

/**
 * Povolené domény JEDNOHO projektu, načtené v jeho kontextu.
 *
 * NAHRAZUJE `selectAllTrackingDomains()`, který četl celou tabulku NAPŘÍČ
 * PROJEKTY, tedy bez `mlain.workspace_id`. Tabulka `tracking_domains` má
 * jedinou politiku `ws_isolation` a ta bez toho nastavení porovnává
 * `workspace_id` s NULL, takže dotaz vracel VŽDY NULA ŘÁDKŮ. Nic přitom
 * nespadlo a cache nad ním vypadala v pořádku. Navenek to bylo „doménu mám
 * v seznamu a stejně nefunguje": `/e/track` vracelo `403 origin_not_allowed`
 * a proklik z `/t/c/` nikdy nepřipojil `ml_token`, takže se návštěva na webu
 * nespojila s kontaktem.
 *
 * Čtení napříč projekty tu není potřeba ani u jedné z obou cest: `/e/**`
 * projekt zná z ověřeného veřejného klíče, `/t/c/` z ověřeného podepsaného
 * tokenu. V obou případech se stačí zeptat na řádky toho jednoho projektu.
 */
export async function selectAllowedOrigins(ctx: WorkspaceContext): Promise<AllowedOrigin[]> {
  return withWorkspace(
    ctx,
    async (tx) =>
      (
        await tx.execute<AllowedOrigin>(sql`
          SELECT host, include_subdomains AS "includeSubdomains"
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

/**
 * Zapíše ověření domény, ze které skutečně dorazil požadavek.
 *
 * PÁRUJE SE STEJNĚ, JAKO SE POVOLUJE ORIGIN, tedy na celý host nebo na hranici
 * tečky u pravidla se subdoménami. Kdyby se porovnávalo jen `host = $2`,
 * projekt s pravidlem `example.cz` a subdoménami by po návštěvě
 * `blog.example.cz` zůstal navždy neověřený: požadavek by prošel, řádek by se
 * nenašel a v rozhraní by dál svítilo „zatím neověřeno".
 *
 * Porovnání jde přes `right(...)`, ne přes `LIKE`: host z hlavičky `Origin`
 * je cizí vstup a v `LIKE` by znaky `%` a `_` byly zástupné.
 *
 * Idempotence stojí na `verified_at IS NULL`. Druhý požadavek z téže domény
 * neaktualizuje nic, takže se čas prvního ověření nepřepisuje.
 *
 * Vrací počet ověřených řádků, aby volající poznal, jestli se něco stalo,
 * a nemusel se ptát druhým dotazem.
 */
export async function markTrackingDomainVerified(
  target: TrackingDomainVerification,
): Promise<number> {
  return withTrackingTx(
    { workspaceId: target.workspaceId, job: 'tracking.domain_verify' },
    async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        UPDATE tracking_domains SET verified_at = now()
         WHERE workspace_id = ${target.workspaceId}
           AND verified_at IS NULL
           AND (
             host = ${target.host}
             OR (include_subdomains AND right(${target.host}, length(host) + 1) = '.' || host)
           )
        RETURNING id
      `);
      return rows.length;
    },
  );
}
