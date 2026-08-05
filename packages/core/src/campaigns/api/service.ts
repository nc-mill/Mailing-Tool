import { sql } from 'drizzle-orm';
import { CONTENT_BLOCK_TYPES } from '@mlain/emails/document/content-stats';
import { loadConfig } from '../../config/index';
import { ApiError } from '../../errors/api-error';
import { queue } from '../../queues/registry';
import { withWorkspace, type Tx, type WorkspaceContext } from '../../tx';
import { rawSql } from '../repo/raw-sql';
import { withPending, type CampaignCounters } from '../types';
import { resolveUndoWindow, undoState } from '../control/undo';

/**
 * Aplikační vrstva mezi cestami veřejného API a doménou kampaní.
 *
 * ODCHYLKA OD PLÁNU, VĚDOMÁ. Plán počítal s objektem služeb v kontextu Hona
 * (`c.get('campaigns')`), který v tomhle repozitáři nikdo nezavádí a P04 ho
 * nevystavuje. Cesty proto volají tenhle modul přímo, stejně jako to dělá
 * doména kontaktů a segmentů. Čtení a jednoduché zápisy nad `campaigns` jsou
 * tady, normativní SQL (materializace, úklid, rekoncilace) zůstává v `repo/`,
 * kam patří podle rozhodnutí D3.
 */

export type CampaignRowFull = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  audience: unknown;
  audience_size: number | null;
  audience_breakdown: unknown;
  audience_built_at: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  /** Předvolba odesílatele, ze které se pět polí výš předvyplnilo. */
  sender_identity_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  revision: number;
  release_at: string | null;
  scheduled_at: string | null;
  schedule_timezone: string | null;
  pause_reason: unknown;
  compiled_html: string | null;
  compiled_fields: string[];
  /**
   * Má kampaň vlastní dokument? Odpovědi API se posílá jen tenhle příznak, ne celý
   * dokument: obrazovka nastavení podle něj pozná, že převzetí jiné šablony obsah
   * PŘEPÍŠE, a stihne se zeptat. Dokument sám má stovky kilobajtů a nikdo ho tam nečte.
   *
   * NEŘÍKÁ NIC O TOM, JESTLI V DOKUMENTU NĚCO JE. Přesně na tomhle rozdílu vada
   * stála: kampaň s dokumentem, ve kterém nebylo nic než patička, měla `design`
   * vyplněný, takže se tvářila jako hotová a odešla prázdná.
   */
  has_design: boolean;
  /**
   * Počet obsahových bloků v celé hloubce dokumentu. Nula znamená e-mail, ve kterém
   * není nic než patička, rozvržení a výplň, tedy prázdný e-mail.
   *
   * Počítá se v SQL, aby se kvůli jednomu číslu netahal celý dokument (u výpisu by
   * to bylo sto dokumentů na jeden požadavek). Seznam typů se skládá z konstanty
   * `CONTENT_BLOCK_TYPES`, takže druhá kopie pravidla nevzniká.
   */
  content_block_count: number;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  delivered_count: number;
  bounce_count: number;
  complaint_count: number;
  started_at: string | null;
  finished_at: string | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Počet obsahových bloků dokumentu, spočítaný v databázi.
 *
 * `jsonb_path_query(design, '$.blocks.**')` projde dokument do libovolné hloubky,
 * takže se započítá i to, co leží ve sloupcích nebo v cyklu. Filtr na
 * `jsonb_typeof(...) = 'object'` je tam proto, že rekurzivní průchod vrací i pole
 * a skaláry, na kterých by `->> 'type'` nedávalo smysl.
 *
 * Seznam typů se skládá z `CONTENT_BLOCK_TYPES`, tedy z TÉŽE konstanty, kterou
 * používá `countContentBlocks` v TypeScriptu. Kdyby se ten seznam napsal do SQL
 * ručně, rozešel by se a rozdíl by se projevil tím, že obrazovka kampaně tvrdí
 * něco jiného než kontrola před odesláním. Hodnoty jsou vlastní konstanty kódu,
 * ne vstup uživatele, takže vložení do dotazu je bezpečné.
 */
const CONTENT_BLOCK_COUNT_SQL = `(
    SELECT count(*)::int FROM jsonb_path_query(design, '$.blocks.**') AS block
     WHERE jsonb_typeof(block) = 'object'
       AND block ->> 'type' IN (${CONTENT_BLOCK_TYPES.map((type) => `'${type}'`).join(', ')})
  )`;

const COLUMNS = `id, workspace_id, name, status, subject, preheader, from_name, from_email,
  reply_to, template_id, audience, audience_size, audience_breakdown, audience_built_at,
  provider_id, sender_domain_id, sender_identity_id, unsubscribe_list_id,
  track_opens, track_clicks, revision,
  release_at, scheduled_at, schedule_timezone, pause_reason, compiled_html, compiled_fields,
  total_count, sent_count, failed_count, skipped_count, delivered_count, bounce_count,
  complaint_count, started_at, finished_at, paused_at, created_at, updated_at,
  (design IS NOT NULL) AS has_design,
  ${CONTENT_BLOCK_COUNT_SQL} AS content_block_count`;

export function counters(row: CampaignRowFull): CampaignCounters {
  return withPending({
    total: row.total_count,
    sent: row.sent_count,
    failed: row.failed_count,
    skipped: row.skipped_count,
    delivered: row.delivered_count,
    bounced: row.bounce_count,
    complained: row.complaint_count,
  });
}

export async function listCampaigns(
  ctx: WorkspaceContext,
  input: { status?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<{ rows: CampaignRowFull[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit, 1), 100);
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRowFull>(
      rawSql(
        `SELECT ${COLUMNS} FROM campaigns
          WHERE workspace_id = $1
            AND deleted_at IS NULL
            -- Skryté systémové kampaně (testovací odeslání šablony, migrace 0010)
            -- do seznamu nepatří: uživatel je nezaložil a nemůže s nimi nic dělat.
            AND kind = 'campaign'
            AND ($2::text IS NULL OR status = $2)
            AND ($3::uuid IS NULL OR id < $3)
          ORDER BY updated_at DESC, id DESC
          LIMIT ${limit + 1}`,
        [ctx.workspaceId, input.status ?? null, input.cursor ?? null],
      ),
    );
    const rows = r.rows.slice(0, limit);
    return { rows, hasMore: r.rows.length > limit };
  });
}

export async function getCampaignFull(
  ctx: WorkspaceContext,
  id: string,
): Promise<CampaignRowFull | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRowFull>(
      rawSql(
        // `kind = 'campaign'` je tu proto, aby se systémová kampaň nedala načíst
        // ani přímo podle identifikátoru, a tedy ani upravit cestou PATCH.
        `SELECT ${COLUMNS} FROM campaigns
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND kind = 'campaign'`,
        [id, ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
}

export type CreateCampaignInput = {
  name: string;
  subject?: string | undefined;
  preheader?: string | undefined;
  from_name?: string | undefined;
  from_email?: string | undefined;
  reply_to?: string | null | undefined;
  template_id?: string | null | undefined;
  audience?: unknown;
  provider_id?: string | null | undefined;
  sender_domain_id?: string | null | undefined;
  sender_identity_id?: string | null | undefined;
  unsubscribe_list_id?: string | null | undefined;
  createdBy?: string | null | undefined;
};

export async function createCampaign(
  ctx: WorkspaceContext,
  input: CreateCampaignInput,
): Promise<CampaignRowFull> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRowFull>(
      rawSql(
        `INSERT INTO campaigns
           (workspace_id, name, subject, preheader, from_name, from_email, reply_to,
            template_id, audience, provider_id, sender_domain_id, unsubscribe_list_id, created_by,
            sender_identity_id)
         VALUES ($1, $2, COALESCE($3,''), COALESCE($4,''), COALESCE($5,''), lower(COALESCE($6,'')),
                 $7, $8, COALESCE($9::jsonb, '{"include":{"lists":[],"segments":[]},"exclude":{"lists":[],"segments":[]}}'::jsonb),
                 $10, $11, $12, $13, $14)
         RETURNING ${COLUMNS}`,
        [
          ctx.workspaceId,
          input.name,
          input.subject ?? null,
          input.preheader ?? null,
          input.from_name ?? null,
          input.from_email ?? null,
          input.reply_to ?? null,
          input.template_id ?? null,
          input.audience === undefined ? null : JSON.stringify(input.audience),
          input.provider_id ?? null,
          input.sender_domain_id ?? null,
          input.unsubscribe_list_id ?? null,
          input.createdBy ?? null,
          input.sender_identity_id ?? null,
        ],
      ),
    );
    return r.rows[0]!;
  });
}

/** Sloupce API na sloupce databáze. Klíč, který tady není, se nedá změnit vůbec. */
const PATCHABLE: Record<string, string> = {
  name: 'name',
  subject: 'subject',
  preheader: 'preheader',
  from_name: 'from_name',
  from_email: 'from_email',
  reply_to: 'reply_to',
  template_id: 'template_id',
  audience: 'audience',
  provider_id: 'provider_id',
  sender_domain_id: 'sender_domain_id',
  sender_identity_id: 'sender_identity_id',
  unsubscribe_list_id: 'unsubscribe_list_id',
  track_opens: 'track_opens',
  track_clicks: 'track_clicks',
  scheduled_at: 'scheduled_at',
  schedule_timezone: 'schedule_timezone',
};

/**
 * Sloupce, jejichž změna posouvá `revision`. Sender si obsah kampaně drží v cache
 * pod klíčem (campaign_id, revision), takže bez inkrementu by po úpravě předmětu
 * odesílal starou hlavičku (rozhodnutí D22).
 */
const REVISION_BUMPING = new Set([
  'subject',
  'preheader',
  'from_name',
  'from_email',
  'reply_to',
  'template_id',
  'provider_id',
  'sender_domain_id',
  'track_opens',
  'track_clicks',
  'unsubscribe_list_id',
]);

/**
 * První vyplnění obsahu kampaně z šablony. NIKDY přepsání.
 *
 * Obsah kampaně žije v `campaigns.design`, `template_id` je jen záznam o původu.
 * `design` sám o sobě zapisovatelný není (není v `PatchCampaignRequest` ani
 * v `PATCHABLE`) a je to schválně: obsah je jediná věc, o kterou uživatel může
 * přijít nenávratně, takže se do něj nesahá klíčem v částečném zápisu.
 *
 * Tenhle výraz proto plní `design` jen tehdy, když je PRÁZDNÝ. Kdyby uměl
 * přepisovat, ztratila by se rozdělaná práce jediným uložením nastavení, protože
 * formulář posílá `template_id` při každém uložení. Přepis vlastní výhradně
 * `POST /campaigns/{id}/apply-template`, kde se na něj UI stihne zeptat.
 *
 * Podmínka čte STARÉ hodnoty sloupců: v `UPDATE` se pravá strana všech přiřazení
 * vyhodnocuje nad řádkem před změnou, takže `design IS NULL` platí i tehdy, když
 * tentýž příkaz nastavuje `template_id`.
 */
const FILL_TEMPLATE_DESIGN = `design = CASE
    WHEN %TID% IS NOT NULL AND design IS NULL
      THEN (SELECT t.design FROM templates t
             WHERE t.id = %TID% AND t.workspace_id = $2 AND t.deleted_at IS NULL)
    ELSE design
  END`;

export async function updateCampaign(
  ctx: WorkspaceContext,
  id: string,
  patch: Record<string, unknown>,
): Promise<CampaignRowFull | null> {
  const keys = Object.keys(patch).filter((k) => PATCHABLE[k] !== undefined);
  if (keys.length === 0) return getCampaignFull(ctx, id);

  const bump = keys.some((k) => REVISION_BUMPING.has(k));
  const assignments = keys.map((k, i) => {
    const column = PATCHABLE[k]!;
    if (k === 'audience') return `${column} = $${i + 3}::jsonb`;
    if (k === 'from_email') return `${column} = lower($${i + 3})`;
    return `${column} = $${i + 3}`;
  });
  const values = keys.map((k) => (k === 'audience' ? JSON.stringify(patch[k]) : patch[k]));

  const templateIndex = keys.indexOf('template_id');
  if (templateIndex >= 0) {
    assignments.push(FILL_TEMPLATE_DESIGN.replaceAll('%TID%', `$${templateIndex + 3}::uuid`));
  }

  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRowFull>(
      rawSql(
        `UPDATE campaigns
            SET ${assignments.join(', ')},
                revision = revision + ${bump ? 1 : 0},
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          RETURNING ${COLUMNS}`,
        [id, ctx.workspaceId, ...values],
      ),
    );
    return r.rows[0] ?? null;
  });
}

/**
 * Stavy, ze kterých se kampaň smí smazat. Je to TÝŽ výčet, jaký pouští `PATCH`
 * k úpravám, a schválně: kampaň, kterou jde ještě přepsat, se ještě nikomu
 * neodeslala, takže se s ní nemaže žádná historie.
 *
 * `schedule_missed` je propásnutý plán, tedy kampaň, která nikdy neodešla.
 * Dokud tady chyběl, nešla taková kampaň z rozhraní smazat vůbec: `unschedule`
 * na ni nesedí (žádný plán už neběží) a jiná cesta pryč neexistovala.
 *
 * Odeslaná, běžící ani naplánovaná kampaň tu být nesmí. Odeslaná je doklad
 * o tom, co komu odešlo, běžící by se mazala pod rukama odesílacímu procesu
 * a naplánovaná musí nejdřív přes `unschedule`, aby uživatel viděl, že rušením
 * plánu nic neodešle.
 */
const DELETABLE_STATUSES: readonly string[] = ['draft', 'schedule_missed'];

/**
 * Měkké smazání kampaně, tedy přesun do koše. Řádek zůstává, jen ho všechna
 * čtení přeskočí (`deleted_at IS NULL` je v každém dotazu domény).
 *
 * ODESÍLACÍ DOMÉNA A ÚČET SE ODPOJUJÍ. `campaigns.sender_domain_id`
 * i `campaigns.provider_id` mají cizí klíč `ON DELETE RESTRICT` a ten se dívá
 * na existenci řádku, ne na `deleted_at`. Kampaň v koši by proto doménu držela
 * napořád a `DELETE /domains/{id}` by hlásil `domain_has_campaigns` s radou
 * kampaň smazat natrvalo, jenže trvalé mazání kampaní API nezná. Byla by to
 * slepá ulička. Odpojit se to smí bez ztráty: mazat jde jen kampaň, která
 * nikdy neodešla, takže v těch dvou sloupcích není žádný doklad o minulosti.
 *
 * Cizí klíče MÍŘÍCÍ na kampaň se tímhle netrápí. Měkké smazání je `UPDATE`,
 * takže se `ON DELETE` pravidla dětských tabulek vůbec nevyhodnocují a chyba
 * 23503 tu vzniknout nemůže.
 */
export async function softDeleteCampaign(
  ctx: WorkspaceContext,
  id: string,
): Promise<{ deleted: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE campaigns
            SET deleted_at = now(),
                updated_at = now(),
                sender_domain_id = NULL,
                provider_id = NULL
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
            AND status = ANY($3::text[])`,
        [id, ctx.workspaceId, DELETABLE_STATUSES],
      ),
    );
    return { deleted: (r.rowCount ?? 0) > 0 };
  });
}

/**
 * Kopie kampaně je vždycky `draft` s vynulovanými čítači a bez zmrazeného publika.
 * Kopírovat `audience_built_at` by znamenalo vyrobit druhou kampaň se stejným
 * invariantem I1 a unikátní index v outboxu by ji rozbil až při materializaci.
 */
export async function duplicateCampaign(
  ctx: WorkspaceContext,
  id: string,
): Promise<CampaignRowFull | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRowFull>(
      rawSql(
        `INSERT INTO campaigns
           (workspace_id, name, status, subject, preheader, from_name, from_email, reply_to,
            template_id, design, audience, provider_id, sender_domain_id, unsubscribe_list_id,
            track_opens, track_clicks, created_by, sender_identity_id)
         SELECT workspace_id, left(name || ' (kopie)', 200), 'draft', subject, preheader,
                from_name, from_email, reply_to, template_id, design, audience, provider_id,
                sender_domain_id, unsubscribe_list_id, track_opens, track_clicks, created_by,
                sender_identity_id
           FROM campaigns
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND kind = 'campaign'
         RETURNING ${COLUMNS}`,
        [id, ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
}

export type MessageRow = {
  id: string;
  created_at: string;
  status: string;
  error_code: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
};

/**
 * Výpis zpráv kampaně. Vrací `id` I `created_at`, protože `messages` je
 * partitionovaná podle `created_at` a samotné `id` řádek nezadresuje.
 * Filtr na `created_at = audience_built_at` drží dotaz v jediné partition.
 */
export async function listCampaignMessages(
  ctx: WorkspaceContext,
  campaignId: string,
  input: { status?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<{ rows: MessageRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<MessageRow>(
      rawSql(
        `SELECT m.id, m.created_at, m.status, m.error_code, m.provider_message_id, m.sent_at
           FROM messages m
           JOIN campaigns c ON c.id = m.campaign_id AND c.workspace_id = m.workspace_id
          WHERE m.workspace_id = $1
            AND m.campaign_id = $2
            AND m.created_at = c.audience_built_at
            AND ($3::text IS NULL OR m.status = $3)
            AND ($4::uuid IS NULL OR m.id > $4)
          ORDER BY m.id
          LIMIT ${limit + 1}`,
        [ctx.workspaceId, campaignId, input.status ?? null, input.cursor ?? null],
      ),
    );
    const rows = r.rows.slice(0, limit);
    return { rows, hasMore: r.rows.length > limit };
  });
}

/*
 * Nejisté odeslání (rozhodnutí D16) mělo dřív vlastní funkci `ambiguousCount`
 * s vlastním dotazem. Přestěhovalo se do `repo/live-progress.ts`, kde se počítá
 * jedním průchodem spolu se zbytkem průběhu: druhý dotaz nad toutéž tabulkou
 * ve stejném požadavku byl jen dražší způsob, jak dostat totéž číslo.
 */

export type WorkspaceCampaignSettings = {
  undo_window_seconds?: number;
  trial_mode?: boolean;
  trial_verified?: Array<{ email: string; verified_at: string | null }>;
};

export type WorkspaceDeliverabilitySettings = {
  bounce_guard_rate?: number;
  complaint_guard_rate?: number;
  bounce_warn_rate?: number;
  complaint_warn_rate?: number;
  guard_min_sent?: number;
};

/** Nastavení projektu z `workspaces.settings`, dva klíče: `campaigns` a `deliverability`. */
export async function readWorkspaceSettings(ctx: WorkspaceContext): Promise<{
  campaigns: WorkspaceCampaignSettings;
  deliverability: WorkspaceDeliverabilitySettings;
}> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ settings: Record<string, unknown> | null }>(
      rawSql(`SELECT settings FROM workspaces WHERE id = $1`, [ctx.workspaceId]),
    );
    const settings = r.rows[0]?.settings ?? {};
    return {
      campaigns: (settings['campaigns'] ?? {}) as WorkspaceCampaignSettings,
      deliverability: (settings['deliverability'] ?? {}) as WorkspaceDeliverabilitySettings,
    };
  });
}

export async function writeWorkspaceSettingsKey(
  ctx: WorkspaceContext,
  key: 'campaigns' | 'deliverability',
  value: unknown,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE workspaces
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[$2::text], $3::jsonb, true),
                updated_at = now()
          WHERE id = $1`,
        [ctx.workspaceId, key, JSON.stringify(value)],
      ),
    );
  });
}

/** Okno na zrušení odeslání, s instalační hodnotou jako stropem (rozhodnutí D12). */
export function undoWindowSeconds(settings: WorkspaceCampaignSettings): number {
  const limits = { CAMPAIGN_UNDO_WINDOW_SECONDS: loadConfig().CAMPAIGN_UNDO_WINDOW_SECONDS };
  return resolveUndoWindow(settings, limits);
}

export function undoRemainingSeconds(row: CampaignRowFull, now: Date): number {
  const state = undoState({
    sentCount: row.sent_count,
    releaseAt: row.release_at === null ? null : new Date(row.release_at),
    now,
  });
  return state.canUndo ? state.remainingSeconds : 0;
}

/**
 * Zařazení jobu do fronty. Politika se ČTE z registru P01, neopisuje se: dvě kopie
 * retry a expirace by se rozešly a rozdíl by se projevil až v produkci.
 *
 * Zapisuje se přímo do tabulky pg-boss, protože jde o zveřejněný způsob
 * transakčního vkládání. Tvar dotazu je opsaný z `segments/jobs/enqueue.ts`,
 * aby v repozitáři nevznikl druhý, jinak se chovající způsob zařazení.
 */
export async function enqueueCampaignJob(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>,
  options: { singletonKey?: string; startAfterSeconds?: number } = {},
): Promise<void> {
  const entry = queue(name);
  const schema = loadConfig().PGBOSS_SCHEMA;
  await tx.execute(sql`
    INSERT INTO ${sql.identifier(schema)}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after)
    VALUES (
      ${name},
      ${JSON.stringify(payload)}::jsonb,
      ${options.singletonKey ?? null},
      ${entry.retryLimit},
      ${entry.retryBackoff},
      ${entry.expireInSeconds},
      now() + make_interval(secs => ${options.startAfterSeconds ?? 0})
    )
  `);
}

export async function enqueueInWorkspace(
  ctx: WorkspaceContext,
  name: string,
  payload: Record<string, unknown>,
  options: { singletonKey?: string; startAfterSeconds?: number } = {},
): Promise<void> {
  await withWorkspace(ctx, (tx) => enqueueCampaignJob(tx, name, payload, options));
}

/** Kampaň, která na API neexistuje, je 404. Sdílené místo, aby se text neopisoval. */
export function requireCampaign(row: CampaignRowFull | null): CampaignRowFull {
  if (!row) throw new ApiError('not_found');
  return row;
}
