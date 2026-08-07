import { withWorkspace, type WorkspaceContext } from '../../tx';
import { ApiError } from '../../errors/api-error';
// ODCHYLKA OD PLÁNU: plán zakládal druhý `raw-sql.ts` v `providers/repo/`. Byla by to
// druhá kopie téže funkce v témž balíčku, tedy přesně ta konstrukce, která se za půl
// roku rozejde. Nese se ta jediná, kterou zavedl úkol 2.
import { rawSql } from '../../campaigns/repo/raw-sql';

export type ProviderRow = {
  id: string;
  workspace_id: string;
  name: string;
  type: string;
  config_public: unknown;
  is_default: boolean;
  status: string;
  status_detail: unknown;
  verified_at: string | null;
  quota_max_24h: number | null;
  quota_max_send_rate: string | null;
  quota_sent_24h: number | null;
  production_access: boolean | null;
  enforcement_status: string | null;
  sending_enabled: boolean | null;
  /**
   * Stav žádosti o produkční přístup u Amazonu, z `Details.ReviewDetails.Status`
   * v odpovědi SES v2 `GetAccount`. Hodnoty podle výčtu `ReviewStatus` v AWS SDK:
   * `PENDING`, `GRANTED`, `DENIED`, `FAILED`. `null` znamená, že účet o přístup
   * nikdy nežádal, nebo že jsme se Amazona ještě neptali.
   *
   * Dokud sloupec chyběl (do migrace 0025), hodnota se z Amazonu načetla a zahodila.
   * Pak se sice ukládala, ale nebyla ve výčtu níž, takže ji nikdo nepřečetl. Bez ní
   * neumí preflight rozlišit „čeká se na schválení" od „Amazon zamítl", což je
   * rozdíl mezi „počkej si" a „takhle to nikdy neodejde".
   */
  review_status: string | null;
  quota_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ SCHÉMATEM A OVĚŘENÁ SPUŠTĚNÍM. Plán psal sloupce
 * `quota_max_24h` a `quota_sent_24h`. Tak se ve schématu NEJMENUJÍ: P03 je má v Drizzle
 * jako `quotaMax24h` a `quotaSent24h`, a převod na snake_case skupinu `Max24h` nerozdělí,
 * takže v databázi stojí `quota_max24h` a `quota_sent24h`. Dotaz podle plánu skončí
 * chybou 42703 (ověřeno: „column quota_max_24h of relation sending_providers does not exist").
 *
 * Doménový tvar `ProviderRow` si podtržítko ponechává, protože v něm ho má i `AccountSnapshot`
 * a celé veřejné API. Překlad se dělá JEDNOU, tady, aliasem ve dvou dotazech; přejmenovávat
 * kvůli tomu doménu by znamenalo rozsévat `quota_max24h` po celém API.
 */
const PUBLIC_COLUMNS = `id, workspace_id, name, type, config_public, is_default, status,
  status_detail, verified_at, quota_max24h AS quota_max_24h, quota_max_send_rate,
  quota_sent24h AS quota_sent_24h,
  production_access, enforcement_status, sending_enabled, review_status,
  quota_checked_at, created_at, updated_at`;

/** config_encrypted se ze zadneho ctecího dotazu nevraci. Sifra se cte jen pri volani AWS. */
export async function getProviderById(
  ctx: WorkspaceContext,
  id: string,
): Promise<ProviderRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<ProviderRow>(
      rawSql(
        `SELECT ${PUBLIC_COLUMNS} FROM sending_providers WHERE id = $1 AND workspace_id = $2`,
        [id, ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
}

export async function getProviderSecret(ctx: WorkspaceContext, id: string): Promise<string | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ config_encrypted: string }>(
      rawSql(`SELECT config_encrypted FROM sending_providers WHERE id = $1 AND workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0]?.config_encrypted ?? null;
  });
}

export type CreateProviderInput = {
  name: string;
  type: string;
  configEncrypted: string;
  configPublic: unknown;
  isDefault: boolean;
};

export async function createProvider(
  ctx: WorkspaceContext,
  input: CreateProviderInput,
): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    if (input.isDefault) {
      await tx.execute(
        rawSql(`UPDATE sending_providers SET is_default = false WHERE workspace_id = $1`, [
          ctx.workspaceId,
        ]),
      );
    }
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted, config_public, is_default)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
        [
          ctx.workspaceId,
          input.name,
          input.type,
          input.configEncrypted,
          JSON.stringify(input.configPublic),
          input.isDefault,
        ],
      ),
    );
    return r.rows[0]!.id;
  });
}

export async function setDefaultProvider(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(`UPDATE sending_providers SET is_default = false WHERE workspace_id = $1`, [
        ctx.workspaceId,
      ]),
    );
    await tx.execute(
      rawSql(
        `UPDATE sending_providers SET is_default = true, updated_at = now() WHERE id = $1 AND workspace_id = $2`,
        [id, ctx.workspaceId],
      ),
    );
  });
}

export type AccountSnapshotColumns = {
  quota_max_24h: number | null;
  quota_max_send_rate: number | null;
  quota_sent_24h: number | null;
  production_access: boolean | null;
  enforcement_status: string | null;
  sending_enabled: boolean | null;
  review_status: string | null;
};

/**
 * Snímek účtu z odpovědi Amazonu na `GetAccount`.
 *
 * `review_status` stojí v příkazu NATVRDO. Do migrace 0025 se sloupec za běhu
 * dohledával v `information_schema` a při neexistenci se z `UPDATE` vynechal,
 * protože žádná migrace ho nezaváděla a natvrdo psaný příkaz by skončil chybou
 * 42703. Padlo by s ním i načtení kvót, na kterých stojí automatická pauza
 * kampaně, takže se tehdy obcházení vyplatilo.
 *
 * Sloupec zavádí migrace 0025 a obcházení je od té chvíle MRTVÝ KÓD, který
 * svádí k domněnce, že je sloupec volitelný. Kdyby chyběl, má zápis spadnout
 * hlasitě, ne se tiše ochudit o jedno pole.
 */
export async function updateAccountSnapshot(
  ctx: WorkspaceContext,
  id: string,
  a: AccountSnapshotColumns,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        // Skutečná jména sloupců jsou `quota_max24h` a `quota_sent24h`, viz PUBLIC_COLUMNS.
        `UPDATE sending_providers
          SET quota_max24h = $3, quota_max_send_rate = $4, quota_sent24h = $5,
              production_access = $6, enforcement_status = $7, sending_enabled = $8,
              review_status = $9,
              quota_checked_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
        [
          id,
          ctx.workspaceId,
          a.quota_max_24h,
          a.quota_max_send_rate,
          a.quota_sent_24h,
          a.production_access,
          a.enforcement_status,
          a.sending_enabled,
          a.review_status,
        ],
      ),
    );
  });
}

export async function setProviderStatus(
  ctx: WorkspaceContext,
  id: string,
  status: string,
  detail?: unknown,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE sending_providers SET status = $3, status_detail = $4::jsonb, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
        [id, ctx.workspaceId, status, detail === undefined ? null : JSON.stringify(detail)],
      ),
    );
  });
}

export async function listStaleQuota(
  ctx: WorkspaceContext,
  opts: { limit: number },
): Promise<Array<{ id: string }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `SELECT id FROM sending_providers
        WHERE workspace_id = $1 AND status IN ('ready','degraded')
        ORDER BY quota_checked_at NULLS FIRST
        LIMIT ${Number(opts.limit)}`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}

export async function deleteProvider(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const running = await tx.execute<{ n: number }>(
      rawSql(
        `SELECT count(*)::int AS n FROM campaigns
        WHERE workspace_id = $1 AND provider_id = $2
          AND status IN ('queueing','sending','paused','scheduled') AND deleted_at IS NULL`,
        [ctx.workspaceId, id],
      ),
    );
    if (running.rows[0]!.n > 0) {
      // ODCHYLKA OD PLÁNU: plán házel `AppError` s polem `detail`. Repozitář má
      // `ApiError` a strojově čitelné údaje nese v `params`. Kód `conflict` i chování
      // zůstávají; `ApiError.message` je právě ten kód, takže se pozná i podle textu.
      throw new ApiError('conflict', {
        params: { reason: 'Odesílací účet má rozpracovanou kampaň.', providerId: id },
      });
    }
    // Skryté systémové kampaně (testovací odeslání šablony, migrace 0010) se
    // uklidí PŘED smazáním účtu. Bez toho spadne mazání na cizím klíči
    // `campaigns.provider_id` s ON DELETE RESTRICT (chyba 23001) a uživatel
    // dostane hlášku o kampani, kterou v seznamu nevidí a nemá jak smazat.
    // Ověřeno spuštěním: měkké smazání NESTAČÍ, RESTRICT se dívá na existenci
    // řádku, ne na `deleted_at`.
    //
    // Maže se natvrdo i s čekajícími testovacími zprávami, a je to správně:
    // obojí je jednorázová věc bez historické hodnoty a bez odesílacího účtu
    // by ty zprávy stejně nikdy neodešly. Zprávy musí jít první, jinak by po
    // kampani zůstaly viset s odkazem na neexistující kampaň a sender by je
    // claimoval donekonečna naprázdno.
    await tx.execute(
      rawSql(
        `DELETE FROM messages
          WHERE workspace_id = $1 AND kind = 'test'
            AND campaign_id IN (SELECT id FROM campaigns
                                 WHERE workspace_id = $1 AND provider_id = $2
                                   AND kind = 'system')`,
        [ctx.workspaceId, id],
      ),
    );
    await tx.execute(
      rawSql(
        `DELETE FROM campaigns
          WHERE workspace_id = $1 AND provider_id = $2 AND kind = 'system'`,
        [ctx.workspaceId, id],
      ),
    );
    await tx.execute(
      rawSql(`DELETE FROM sending_providers WHERE id = $1 AND workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
  });
}
