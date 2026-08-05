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

/**
 * Uložení výsledku kontroly DNS.
 *
 * `verified_at` se tady ZÁMĚRNĚ NENASTAVUJE, přestože to dřív dělalo. Naše
 * kontrola DNS je předpověď, ne verdikt: říká, že záznamy v DNS vidíme my.
 * Jestli je vidí i Amazon a uzná identitu za ověřenou, ví jenom Amazon, a řekne
 * to v `GetEmailIdentity`. Dokud se `verified_at` plnilo z vlastní kontroly,
 * tvrdila aplikace „doména ověřena" u domény, kterou měl Amazon na `PENDING`,
 * a na tomhle rozporu stál i výchozí zkušební režim, který se podle
 * `verified_at` vypínal. Zdroj pravdy je `saveIdentity` níž.
 */
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

export type SaveIdentityInput = {
  /** Doslovná hodnota od Amazonu: `SUCCESS`, `PENDING`, `FAILED`, `NOT_STARTED`. */
  sesVerificationStatus: string | null;
  dkimStatus: string | null;
  dkimTokens: string[];
  dkimHostedZone: string | null;
  mailFromStatus: string | null;
};

/**
 * ZDROJ PRAVDY O OVĚŘENÍ DOMÉNY: odpověď Amazonu na `GetEmailIdentity`.
 *
 * `verified_at` se plní VÝHRADNĚ tady a výhradně z hodnoty `SUCCESS`. Ověřená
 * doména je ta, kterou za ověřenou považuje ten, kdo doručuje, ne ta, u které
 * my sami vidíme v DNS správné záznamy. Rozdíl není teoretický: `brevio.cz`
 * měla v DNS všechno v pořádku, `verified_at` vyplněné z naší kontroly a Amazon
 * ji přitom držel na `PENDING`.
 *
 * Když Amazon řekne cokoli jiného než `SUCCESS`, `verified_at` se MAŽE. Držet
 * historickou hodnotu by znamenalo, že si projekt po odebrání ověření u Amazonu
 * dál myslí, že má ověřenou doménu, a vypne si podle toho zkušební režim.
 * Když se Amazona nedovoláme, funkce se nevolá vůbec a hodnota zůstane, jaká byla.
 *
 * DKIM tokeny se přepisují jen tehdy, když nějaké přišly: prázdná odpověď
 * nesmí uživateli vymazat záznamy, které si právě opisuje do DNS.
 */
export async function saveIdentity(
  ctx: WorkspaceContext,
  id: string,
  input: SaveIdentityInput,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE sender_domains
          SET ses_verification_status = $3,
              dkim_status = COALESCE($4, dkim_status),
              dkim_tokens = CASE WHEN array_length($5::text[], 1) IS NULL
                                 THEN dkim_tokens ELSE $5::text[] END,
              dkim_hosted_zone = COALESCE($6, dkim_hosted_zone),
              mail_from_status = COALESCE($7, mail_from_status),
              verified_at = CASE WHEN $3 = 'SUCCESS' THEN COALESCE(verified_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
        [
          id,
          ctx.workspaceId,
          input.sesVerificationStatus,
          input.dkimStatus,
          input.dkimTokens,
          input.dkimHostedZone,
          input.mailFromStatus,
        ],
      ),
    );
  });
}

/** Má projekt aspoň jednu doménu, kterou za ověřenou uznal poskytovatel? */
export async function hasProviderVerifiedDomain(
  ctx: WorkspaceContext,
  providerId: string,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM sender_domains
          WHERE workspace_id = $1 AND provider_id = $2 AND verified_at IS NOT NULL`,
        [ctx.workspaceId, providerId],
      ),
    );
    return (r.rows[0]?.n ?? 0) > 0;
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
