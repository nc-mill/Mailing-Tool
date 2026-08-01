import { withWorkspace, type WorkspaceContext } from '../../tx';
import type { AudienceGateCounts } from '../ports';
import { rawSql } from './raw-sql';

export { ZERO_UUID } from '../materialize/plan-constants';

export type AudienceProgress = {
  campaign_id: string;
  phase: 'collecting' | 'materializing' | 'done';
  cursor_contact_id: string | null;
  inserted_rows: number;
  skipped_suppressed: number;
  skipped_unsubscribed: number;
  skipped_invalid: number;
};

/**
 * Krok 1, jednou na kampan, atomicky. audience_built_at se nastavuje pres COALESCE,
 * takze opakovani ho nezmeni, a zaokrouhluje se na cele sekundy: invariant I1 kontraktu
 * na tom stoji a trackovaci token potrebuje hodnotu reprezentovatelnou jako uint32.
 *
 * TYMZ dotazem se pocita `release_at`, tedy konec okna na zruseni odeslani. Je to
 * jedine misto v celem planu, kde ta hodnota vznika. Predchozi podoba ji cekala
 * v `deps.config.releaseAt`, kam ji nikdy nikdo nezapsal, takze `undoState` dostaval
 * vzdy null, vracel `canUndo: false` a rozhodnuti D12 potvrzene zadavatelem bylo
 * fakticky nezapojene. Nic pritom nespadlo, tlacitko se jen nikdy neobjevilo.
 *
 * Pocita se ze stejneho `now()` jako `audience_built_at`, aby okno zacinalo presne
 * tam, kde vznika publikum, a `COALESCE` zajistuje, ze opakovany beh okno neposune.
 */
export async function startMaterialization(
  ctx: WorkspaceContext,
  campaignId: string,
  undoWindowSeconds: number,
): Promise<{ audienceBuiltAt: string | null; releaseAt: string | null; claimed: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    const claim = await tx.execute<{ audience_built_at: string; release_at: string | null }>(
      rawSql(
        `UPDATE campaigns
            SET status = 'queueing',
                audience_built_at = COALESCE(audience_built_at, date_trunc('second', now())),
                release_at = COALESCE(
                  release_at,
                  CASE WHEN $3::int > 0
                       THEN date_trunc('second', now()) + ($3::int || ' seconds')::interval
                  END),
                started_at = COALESCE(started_at, now()),
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2
            AND status IN ('draft','scheduled','schedule_missed')
          RETURNING audience_built_at, release_at`,
        [campaignId, ctx.workspaceId, undoWindowSeconds],
      ),
    );

    await tx.execute(
      rawSql(
        `INSERT INTO campaign_audience_progress (campaign_id, workspace_id, phase)
         VALUES ($1, $2, 'materializing')
         ON CONFLICT (campaign_id) DO NOTHING`,
        [campaignId, ctx.workspaceId],
      ),
    );

    if (claim.rows[0]) {
      return {
        audienceBuiltAt: claim.rows[0].audience_built_at,
        releaseAt: claim.rows[0].release_at,
        claimed: true,
      };
    }

    // Nacteni SELECTem je nutne, ne kosmeticke: bez nej by druhy beh neznal hodnotu
    // invariantu I1 a musel by ji generovat znovu, cimz by vznikla druha sada
    // created_at a unikatni index by duplicity prestal zachytavat.
    const cur = await tx.execute<{
      status: string;
      audience_built_at: string | null;
      release_at: string | null;
    }>(
      rawSql(
        `SELECT status, audience_built_at, release_at FROM campaigns
          WHERE id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return {
      audienceBuiltAt: cur.rows[0]?.audience_built_at ?? null,
      releaseAt: cur.rows[0]?.release_at ?? null,
      claimed: false,
    };
  });
}

export async function getProgress(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<AudienceProgress | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<AudienceProgress>(
      rawSql(
        `SELECT * FROM campaign_audience_progress WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
}

/** Posun kurzoru po davce. Bez nej by obnova po padu workeru zacinala od zacatku. */
export async function advanceCursor(
  ctx: WorkspaceContext,
  input: { campaignId: string; cursor: string; inserted: number },
): Promise<void> {
  await withWorkspace(ctx, (tx) =>
    tx.execute(
      rawSql(
        `UPDATE campaign_audience_progress
            SET cursor_contact_id = $3,
                inserted_rows = inserted_rows + $4,
                updated_at = now()
          WHERE campaign_id = $1 AND workspace_id = $2`,
        [input.campaignId, ctx.workspaceId, input.cursor, input.inserted],
      ),
    ),
  );
}

/**
 * Uklada rozpad po branach na DVE mista, a je to zamerne.
 *
 * `campaign_audience_progress` ma jen tri agregaty a slouzi UKAZATELI POSTUPU. Rozsirovat
 * ho o dalsich osm sloupcu nema smysl: je to provozni tabulka, ktera po dokonceni
 * materializace uz nikoho nezajima.
 *
 * `campaigns.audience_breakdown` dostane CELY jedenactiklicovy rozpad a slouzi REPORTU.
 * Bez nej by byl ten sloupec mrtvy (v predchozi podobe planu do nej nikdo nezapisoval
 * ani jednou) a radek "Vyloučeno" v kontrolnim seznamu by musel byt souhrnny, coz
 * cast 6 v 8.6.2 vyslovne zakazuje.
 *
 * Oboji v JEDNE transakci: dve cisla o temze publiku, ktera se muzou rozejit, jsou horsi
 * nez jedno.
 */
export async function setGateCounters(
  ctx: WorkspaceContext,
  campaignId: string,
  gates: AudienceGateCounts,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE campaign_audience_progress
            SET skipped_suppressed = $3, skipped_unsubscribed = $4, skipped_invalid = $5,
                updated_at = now()
          WHERE campaign_id = $1 AND workspace_id = $2`,
        [
          campaignId,
          ctx.workspaceId,
          gates.excluded_suppressed,
          // Ctyri brany, ktere uzivatel vnima jako "neodebira", do jednoho ukazatele postupu.
          // Pojmenovany rozpad zustava v audience_breakdown, tady jde jen o prubeznou zpetnou vazbu.
          gates.excluded_unsubscribed +
            gates.excluded_unconfirmed +
            gates.excluded_snoozed +
            gates.excluded_processing_restricted,
          gates.excluded_invalid_email,
        ],
      ),
    );
    await tx.execute(
      rawSql(
        `UPDATE campaigns
            SET audience_breakdown = $3::jsonb, audience_size = $4, updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId, JSON.stringify(gates), gates.eligible],
      ),
    );
  });
}

/**
 * Krok 3. Podminka `status = 'queueing'` je nosna: opakovane volani je diky ni no-op
 * a kampan pozastavena behem materializace se proto vraci do queueing, ne do sending.
 */
export async function finishMaterialization(
  ctx: WorkspaceContext,
  campaignId: string,
  audienceBuiltAt: string,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE campaigns
            SET status = 'sending',
                total_count = (SELECT count(*) FROM messages
                                WHERE campaign_id = $1 AND created_at = $3::timestamptz
                                  AND kind = 'campaign'),
                audience_size = (SELECT inserted_rows FROM campaign_audience_progress
                                  WHERE campaign_id = $1),
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2 AND status = 'queueing'`,
        [campaignId, ctx.workspaceId, audienceBuiltAt],
      ),
    );
    if (r.rowCount === 0) return false;
    await tx.execute(
      rawSql(
        `UPDATE campaign_audience_progress SET phase = 'done', finished_at = now()
          WHERE campaign_id = $1 AND workspace_id = $2`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return true;
  });
}
