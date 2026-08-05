/**
 * Datová vrstva předvoleb odesílatele.
 *
 * Tvar je opsaný z `providers/repo/domain.ts`, aby v repozitáři nevznikl druhý,
 * jinak se chovající způsob čtení: první parametr je vždycky `WorkspaceContext`,
 * každá funkce si otevírá `withWorkspace` a `workspace_id = $N` je v každém
 * WHERE i přesto, že RLS platí. Pásy i kšandy.
 */
import { withWorkspace, type WorkspaceContext } from '../tx';
// Jediná kopie `rawSql` v repozitáři, viz poznámka v `providers/repo/provider.ts`.
import { rawSql } from '../campaigns/repo/raw-sql';

export type SenderIdentityRow = {
  id: string;
  workspace_id: string;
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  sender_domain_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Řádek předvolby OBOHACENÝ o to, co k němu obrazovka potřebuje dokreslit.
 *
 * Jméno účtu a doména se nedají odvodit z předvolby samotné a nechat je
 * dotáhnout obrazovku by znamenalo N+1 dotazů u seznamu, který má být jedním
 * pohledem. `domain_verified` navíc není totéž co „doména existuje": ověřuje ji
 * Amazon a my tu jen přenášíme jeho verdikt, aby u předvolby mohl být odznak.
 */
export type SenderIdentityView = SenderIdentityRow & {
  provider_name: string;
  provider_status: string;
  domain: string;
  domain_verified: boolean;
};

const VIEW_COLUMNS = `i.id, i.workspace_id, i.name, i.from_name, i.from_email, i.reply_to,
  i.provider_id, i.sender_domain_id, i.is_default, i.created_at, i.updated_at,
  p.name AS provider_name, p.status AS provider_status,
  d.domain AS domain, (d.verified_at IS NOT NULL) AS domain_verified`;

const VIEW_FROM = `FROM sender_identities i
  JOIN sending_providers p ON p.id = i.provider_id AND p.workspace_id = i.workspace_id
  JOIN sender_domains   d ON d.id = i.sender_domain_id AND d.workspace_id = i.workspace_id`;

export async function listSenderIdentities(ctx: WorkspaceContext): Promise<SenderIdentityView[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<SenderIdentityView>(
      rawSql(
        `SELECT ${VIEW_COLUMNS} ${VIEW_FROM}
          WHERE i.workspace_id = $1
          ORDER BY i.is_default DESC, lower(i.name)`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}

export async function getSenderIdentity(
  ctx: WorkspaceContext,
  id: string,
): Promise<SenderIdentityView | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<SenderIdentityView>(
      rawSql(`SELECT ${VIEW_COLUMNS} ${VIEW_FROM} WHERE i.id = $1 AND i.workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0] ?? null;
  });
}

/** Výchozí předvolba projektu, nebo `null`. Čte ji zakládání kampaně. */
export async function getDefaultSenderIdentity(
  ctx: WorkspaceContext,
): Promise<SenderIdentityView | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<SenderIdentityView>(
      rawSql(
        `SELECT ${VIEW_COLUMNS} ${VIEW_FROM} WHERE i.workspace_id = $1 AND i.is_default LIMIT 1`,
        [ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
}

export type SenderIdentityWriteInput = {
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  providerId: string;
  senderDomainId: string;
  isDefault: boolean;
};

/**
 * Založení předvolby.
 *
 * `is_default` se řeší UVNITŘ téže transakce: nejdřív se shodí příznak
 * u ostatních, teprve pak se zapíše nová. Obrácené pořadí by narazilo na
 * částečný unikátní index `uq_sender_identities__one_default` a skončilo
 * chybou 23505 u naprosto legitimní operace.
 *
 * `from_email` a `reply_to` se ukládají malými písmeny, protože to vyžaduje
 * omezení v databázi a protože adresa se stejně porovnává bez ohledu na
 * velikost písmen. Normalizuje se TADY, ne v obrazovce: druhé místo, kde se na
 * to musí myslet, je místo, kde se na to jednou zapomene.
 */
export async function createSenderIdentity(
  ctx: WorkspaceContext,
  input: SenderIdentityWriteInput,
  createdBy: string | null,
): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    if (input.isDefault) {
      await tx.execute(
        rawSql(
          `UPDATE sender_identities SET is_default = false, updated_at = now()
            WHERE workspace_id = $1 AND is_default`,
          [ctx.workspaceId],
        ),
      );
    }
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `INSERT INTO sender_identities
           (workspace_id, name, from_name, from_email, reply_to,
            provider_id, sender_domain_id, is_default, created_by)
         VALUES ($1, $2, $3, lower($4), lower($5), $6, $7, $8, $9)
         RETURNING id`,
        [
          ctx.workspaceId,
          input.name,
          input.fromName,
          input.fromEmail,
          input.replyTo,
          input.providerId,
          input.senderDomainId,
          input.isDefault,
          createdBy,
        ],
      ),
    );
    return r.rows[0]!.id;
  });
}

/**
 * Úprava předvolby. Posílá se VŽDY celá sada pěti údajů, ne dílčí změna:
 * předvolba je jedna věc, ne pět nezávislých polí, a částečná úprava by uměla
 * vyrobit stav, kdy adresa už do domény nepatří, aniž by se domény kdokoli
 * dotkl.
 *
 * Vrací `false`, když řádek neexistuje. Volající z toho udělá 404; rozlišovat
 * to na téhle vrstvě výjimkou by znamenalo, že repo zná stavové kódy HTTP.
 */
export async function updateSenderIdentity(
  ctx: WorkspaceContext,
  id: string,
  input: SenderIdentityWriteInput,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    if (input.isDefault) {
      await tx.execute(
        rawSql(
          `UPDATE sender_identities SET is_default = false, updated_at = now()
            WHERE workspace_id = $1 AND is_default AND id <> $2`,
          [ctx.workspaceId, id],
        ),
      );
    }
    const r = await tx.execute(
      rawSql(
        `UPDATE sender_identities
            SET name = $3, from_name = $4, from_email = lower($5), reply_to = lower($6),
                provider_id = $7, sender_domain_id = $8, is_default = $9, updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [
          id,
          ctx.workspaceId,
          input.name,
          input.fromName,
          input.fromEmail,
          input.replyTo,
          input.providerId,
          input.senderDomainId,
          input.isDefault,
        ],
      ),
    );
    return (r.rowCount ?? 0) > 0;
  });
}

/**
 * Nastavení výchozí předvolby. Týž tvar jako `setDefaultProvider`: nejdřív
 * shodit všechny, pak zvednout jednu, v jedné transakci.
 */
export async function setDefaultSenderIdentity(
  ctx: WorkspaceContext,
  id: string,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE sender_identities SET is_default = false, updated_at = now()
          WHERE workspace_id = $1 AND is_default`,
        [ctx.workspaceId],
      ),
    );
    const r = await tx.execute(
      rawSql(
        `UPDATE sender_identities SET is_default = true, updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [id, ctx.workspaceId],
      ),
    );
    return (r.rowCount ?? 0) > 0;
  });
}

/**
 * Smazání předvolby. Kampaně se NEKONTROLUJÍ a je to záměr, ne opomenutí:
 * `campaigns.sender_identity_id` má `ON DELETE SET NULL`, takže kampaň o odkaz
 * přijde, ale svých pět zkopírovaných hodnot si nechá a odesílá se dál stejně.
 * Kontrola „předvolba se používá" by tedy bránila úklidu kvůli poznámce.
 */
export async function deleteSenderIdentity(ctx: WorkspaceContext, id: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(`DELETE FROM sender_identities WHERE id = $1 AND workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return (r.rowCount ?? 0) > 0;
  });
}

export type DomainOwnership = { domain: string; provider_id: string };

/**
 * Doména i s tím, komu patří. Používá se ke KONTROLE PŘED ZÁPISEM, aby uživatel
 * dostal 422 s vysvětlením místo 23503 z cizího klíče.
 *
 * Cizí klíč `fk_sender_identities__domain` tu kontrolu dělá stejně a je
 * poslední slovo; tohle je jen překlad jeho verdiktu do lidské řeči.
 */
export async function domainOwnership(
  ctx: WorkspaceContext,
  domainId: string,
): Promise<DomainOwnership | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainOwnership>(
      rawSql(`SELECT domain, provider_id FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [
        domainId,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0] ?? null;
  });
}
