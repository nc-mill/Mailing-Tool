import { withWorkspace, type WorkspaceContext } from '../../tx';
import { rawSql } from './raw-sql';

export type CampaignRow = {
  id: string;
  workspace_id: string;
  status: string;
  audience_built_at: string | null;
  revision: number;
  release_at: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  unsubscribe_list_id: string | null;
  scheduled_at: string | null;
  schedule_timezone: string | null;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  delivered_count: number;
  bounce_count: number;
  complaint_count: number;
  pause_reason: unknown;
};

export async function getCampaign(ctx: WorkspaceContext, id: string): Promise<CampaignRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRow>(
      rawSql(`SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0] ?? null;
  });
}

export type TransitionStatusInput = {
  campaignId: string;
  to: string;
  from: readonly string[];
  /** Dalsi sloupce nastavene v temze UPDATE, aby prechod zustal atomicky. */
  set?: Record<string, unknown>;
};

/**
 * Kazdy prechod se dela JEDINYM dotazem s podminkou na vychozi stav, takze dva
 * soubezne pozadavky nemohou provest tentyz prechod dvakrat (cast 4a, 3.1.4).
 * Kdyz dotaz nevrati radek, API vraci 409 invalid_state_transition; volajici tedy
 * musi navratovou hodnotu kontrolovat, ne ji zahodit.
 */
export async function transitionStatus(
  ctx: WorkspaceContext,
  input: TransitionStatusInput,
): Promise<{ id: string; status: string } | null> {
  const extra = Object.entries(input.set ?? {});
  const assignments = extra.map(([col], i) => `${col} = $${i + 5}`).join(', ');
  const text = `
    UPDATE campaigns
       SET status = $3, updated_at = now()${assignments ? `, ${assignments}` : ''}
     WHERE id = $1 AND workspace_id = $2
       AND deleted_at IS NULL
       AND status = ANY($4::text[])
    RETURNING id, status`;
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string; status: string }>(
      rawSql(text, [
        input.campaignId,
        ctx.workspaceId,
        input.to,
        [...input.from],
        ...extra.map(([, v]) => v),
      ]),
    );
    return r.rows[0] ?? null;
  });
}

/**
 * Klic cache senderu je (campaign_id, revision). Inkrementuje se pri kazde zmene
 * kterehokoliv ze sloupcu z IMMUTABLE_WHILE_SENDING, tedy prakticky jen ve stavu draft.
 * Bez toho by sender po duplikaci a novem odeslani drzel zastaralou hlavicku.
 */
export async function bumpRevision(ctx: WorkspaceContext, id: string): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ revision: number }>(
      rawSql(
        `UPDATE campaigns SET revision = revision + 1, updated_at = now()
          WHERE id = $1 AND workspace_id = $2 RETURNING revision`,
        [id, ctx.workspaceId],
      ),
    );
    return r.rows[0]?.revision ?? 0;
  });
}

/** Kampane ve stavu queueing nebo sending daneho providera, pro hromadnou pauzu. */
export async function listRunningCampaignIds(
  ctx: WorkspaceContext,
  providerId?: string,
): Promise<string[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `SELECT id FROM campaigns
          WHERE workspace_id = $1
            AND status IN ('queueing','sending')
            AND deleted_at IS NULL
            AND ($2::uuid IS NULL OR provider_id = $2)`,
        [ctx.workspaceId, providerId ?? null],
      ),
    );
    return r.rows.map((x) => x.id);
  });
}

/** Stav kampane bez zbytku radku. Smycka materializace se na nej pta po kazde davce. */
export async function readCampaignStatus(
  ctx: WorkspaceContext,
  id: string,
): Promise<string | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ status: string }>(
      rawSql(`SELECT status FROM campaigns WHERE id = $1 AND workspace_id = $2`, [
        id,
        ctx.workspaceId,
      ]),
    );
    return r.rows[0]?.status ?? null;
  });
}

/**
 * Planovac bere kampane, jejichz cas nastal a jeste jsou v catch-up okne.
 * `FOR UPDATE SKIP LOCKED` je tam proto, aby dva soubezne behy planovace nevydaly
 * tutez kampan dvakrat.
 */
export async function claimDueCampaigns(
  ctx: WorkspaceContext,
  opts: { catchupHours: number; limit: number },
): Promise<string[]> {
  return (await claimDueCampaignRows(ctx, opts)).map((row) => row.id);
}

/**
 * Totez, ale i s casem, na ktery byla kampan naplanovana.
 *
 * Planovac z nej pocita zpozdeni: nad SCHEDULE_DELAY_NOTIFY_SECONDS zapisuje
 * `campaign.schedule_delayed` do auditu a hlasi udalost, protoze kampan typu
 * "dnesni poledni menu" nema odejit vecer bez upozorneni. Bez `scheduled_at`
 * by tu vetev nemel z ceho vyhodnotit.
 *
 * Je to NADSTAVBA, ne druhy dotaz: `claimDueCampaigns` vraci vysledek teto
 * funkce zuzeny na identifikatory. Dve kopie podminky catch-up okna by se
 * rozesly prvni upravou a poznalo by se to az tim, ze se kampan odeslala,
 * ackoli merlo okno davno uplynout.
 */
export async function claimDueCampaignRows(
  ctx: WorkspaceContext,
  opts: { catchupHours: number; limit: number },
): Promise<Array<{ id: string; scheduledAt: Date }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string; scheduled_at: string | Date }>(
      rawSql(
        `SELECT id, scheduled_at FROM campaigns
        WHERE workspace_id = $1
          AND status = 'scheduled'
          AND deleted_at IS NULL
          AND scheduled_at <= now()
          AND scheduled_at > now() - ($2 || ' hours')::interval
        ORDER BY scheduled_at
        LIMIT ${Number(opts.limit)}
        FOR UPDATE SKIP LOCKED`,
        [ctx.workspaceId, String(opts.catchupHours)],
      ),
    );
    return r.rows.map((x) => ({ id: x.id, scheduledAt: new Date(x.scheduled_at) }));
  });
}

/**
 * Kampan starsi nez catch-up okno se NEODESLE. Prejde do schedule_missed a ceka
 * na rozhodnuti cloveka: kampan typu "dnesni poledni menu" nema odejit vecer.
 */
export async function markScheduleMissed(
  ctx: WorkspaceContext,
  opts: { catchupHours: number },
): Promise<number> {
  return (await markScheduleMissedIds(ctx, opts)).length;
}

/**
 * Totez, ale vraci identifikatory prave prevedenych kampani.
 *
 * Planovac za kazdou z nich hlasi udalost `campaign.schedule_missed` a zapisuje
 * audit, takze samotny POCET mu je k nicemu. Pocitat se neda ani zpetnym
 * dotazem: ten by vratil i kampane prevedene minulym tikem a uzivatel by dostal
 * tutez udalost pri kazdem behu.
 *
 * `rowCount` se ZAMERNE nepouziva, pocet vychazi z delky RETURNING. Jsou to dve
 * cisla, ktera se u UPDATE muzou lisit jen tehdy, kdyz nejaky radek neprojde
 * politikami pro cteni, a v tom pripade je spravne to mensi: nahlasit se da jen
 * kampan, kterou opravdu vidime.
 */
export async function markScheduleMissedIds(
  ctx: WorkspaceContext,
  opts: { catchupHours: number },
): Promise<string[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `UPDATE campaigns
          SET status = 'schedule_missed', updated_at = now()
        WHERE workspace_id = $1
          AND status = 'scheduled'
          AND deleted_at IS NULL
          AND scheduled_at <= now() - ($2 || ' hours')::interval
      RETURNING id`,
        [ctx.workspaceId, String(opts.catchupHours)],
      ),
    );
    return r.rows.map((x) => x.id);
  });
}
