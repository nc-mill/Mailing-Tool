import type { RenderSchema } from '@mlain/emails/compile/types';
import { toPreparedSchema } from '@mlain/emails/paths';
import { loadConfig } from '../../config/index';
import { readDemoManifest } from '../../demo/seed';
import { createSystemContext } from '../../identity/context';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { readTrialState } from '../../providers/api/trial-service';
import type { ResolvedTrialSettings } from '../../providers/trial-mode';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { campaignAudienceGates } from '../api/audience-gates';
import { audiencePort, parseAudience } from '../api/preflight-view';
import { buildAudienceSql } from '../audience/build-sql';
import {
  enqueueCampaignJob,
  readWorkspaceSettings,
  undoWindowSeconds,
  type CampaignRowFull,
} from '../api/service';
import { MATERIALIZE_STATEMENT_TIMEOUT_MS } from '../constants';
import { pauseCampaign } from '../control/pause';
import { runMaterializeLoop, type LoopDeps, type MaterializeLoopInput } from '../materialize/loop';
import {
  advanceCursor,
  finishMaterialization,
  getProgress,
  setGateCounters,
  startMaterialization,
} from '../repo/audience-progress';
import { readCampaignStatus, transitionStatus } from '../repo/campaign';
import { cancelPendingBatch, materializeBatch, type RenderPlan } from '../repo/outbox';
import { rawSql } from '../repo/raw-sql';
import type { KnownCampaignStatus } from '../types';
import type { MaterializeDeps, MaterializeJobPayload } from './materialize';

/**
 * Kompoziční kořen jobů domény kampaní.
 *
 * Handlery v `jobs/` berou závislosti injektované a je to schválně: dají se tak
 * otestovat bez databáze. Někdo je ale složit MUSÍ, jinak je fronta bez obsluhy
 * a úloha se zařadí do prázdna. Tenhle soubor je to místo a je jediné.
 *
 * `loadConfig()` se tu volá VÝHRADNĚ uvnitř funkcí. Na úrovni modulu by shodila
 * každý import, tedy i jednotkový test, který se souboru jen dotkne.
 */

/**
 * Časová zóna projektu. `WorkspaceContext` ji ke dni psaní nenese, takže se bere
 * instalační výchozí hodnota, stejně jako v doméně segmentů.
 *
 * MUSÍ to být tatáž hodnota, jakou používá cesta `GET /preflight`
 * (`campaigns.routes.ts`, konstanta `WORKSPACE_TIMEZONE`). Rozpad publika
 * v kontrolním seznamu a rozpad, který zapíše materializace do
 * `campaigns.audience_breakdown`, se počítají týmž kompilátorem; jiná zóna
 * v jedné z obou cest by u relativních podmínek segmentu vydala jiné publikum
 * a uživatel by viděl, že kontrolní seznam a report po odeslání nesedí.
 */
function workspaceTimezone(): string {
  return loadConfig().DEFAULT_TIMEZONE;
}

/**
 * Plán pro render z ULOŽENÉ `campaigns.compile_meta`.
 *
 * Čte se přímo tady, ne přes `getCampaignFull`: seznam sloupců v `api/service.ts`
 * slouží odpovědi API a `compile_meta` do ní nepatří (je to vnitřek kompilace,
 * ne veřejné pole). Sloupec doplnila migrace `0008_campaigns_compile_meta`.
 *
 * Chybějící nebo neúplná hodnota se hlásí VÝJIMKOU, nikdy náhradním prázdným
 * plánem. Prázdný `usedPaths` by vyrobil zprávy s prázdnou `render_data`
 * a prázdný `presence` by nechal mapu `_present` prázdnou, takže by se každý
 * podmíněný blok v odeslaném mailu tiše skryl (požadavek R11 plánu P08).
 * Handler výjimku zachytí a kampaň převede do `failed` s kódem
 * `campaign_not_compiled`.
 */
async function readRenderPlan(ctx: WorkspaceContext, campaignId: string): Promise<RenderPlan> {
  const meta = await withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ compile_meta: unknown }>(
      rawSql(
        `SELECT compile_meta FROM campaigns
          WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return r.rows[0]?.compile_meta ?? null;
  });

  const parsed = meta as { usedPaths?: unknown; renderSchema?: RenderSchema } | null;
  if (
    parsed === null ||
    !Array.isArray(parsed.usedPaths) ||
    parsed.renderSchema === undefined ||
    !Array.isArray(parsed.renderSchema.fields) ||
    !Array.isArray(parsed.renderSchema.presence)
  ) {
    throw new Error(
      `Kampaň ${campaignId} nemá použitelnou compile_meta, materializace se nesmí rozjet.`,
    );
  }

  // Zúžení přes `toPreparedSchema`, nikdy přetypováním: `RenderSchema` znamená
  // v P08 a v kontraktech DVĚ RŮZNÉ VĚCI a přetypování by kontrolu ztratilo úplně.
  return {
    usedPaths: parsed.usedPaths as string[],
    preparedSchema: toPreparedSchema(parsed.renderSchema),
  };
}

/** Publikum kampaně z uloženého sloupce `audience`. */
async function readCampaignAudience(ctx: WorkspaceContext, campaignId: string) {
  const row = await withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<Pick<CampaignRowFull, 'audience'>>(
      rawSql(
        `SELECT audience FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [campaignId, ctx.workspaceId],
      ),
    );
    return r.rows[0] ?? null;
  });
  const audience = row === null ? null : parseAudience(row.audience);
  if (audience === null) {
    throw new Error(`Kampaň ${campaignId} nemá platné publikum, materializace se nesmí rozjet.`);
  }
  return audience;
}

/**
 * Odchozí událost projektu.
 *
 * Zápis do `webhook_events` a zařazení fan-outu jde v JEDNÉ transakci. Bez
 * zařazení by událost v tabulce ležela a nikdo by ji nerozeslal: `fanoutEvent`
 * volá výhradně job `platform.webhook_fanout` a ten se sám nezařadí.
 */
async function emitEvent(
  ctx: WorkspaceContext,
  input: { type: string; data: Record<string, unknown> },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const eventId = await emitWebhookEvent(tx, {
      workspaceId: ctx.workspaceId,
      type: input.type,
      occurredAt: new Date(),
      data: input.data,
    });
    await enqueueCampaignJob(tx, 'platform.webhook_fanout', {
      event_id: eventId,
      workspace_id: ctx.workspaceId,
    });
  });
}

/**
 * Stav kampaně pro smyčku.
 *
 * Zmizelý řádek se hlásí jako `cancelled`, ne jako neznámý stav: smyčka pak
 * uklidí čekající zprávy a skončí. Kdyby se hlásil jako neznámý, skončila by
 * výsledkem `aborted` a pending řádky po smazané kampani by v outboxu zůstaly
 * navždy, protože je nikdo neclaimne ani neuklidí.
 */
async function loopStatus(ctx: WorkspaceContext, campaignId: string): Promise<KnownCampaignStatus> {
  const status = await readCampaignStatus(ctx, campaignId);
  return (status ?? 'cancelled') as KnownCampaignStatus;
}

function loopDeps(ctx: WorkspaceContext): LoopDeps {
  return {
    batch: async (input) => {
      const r = await materializeBatch(ctx, {
        campaignId: input.campaignId,
        audienceBuiltAt: input.audienceBuiltAt,
        cursor: input.cursor,
        batchSize: input.batchSize,
        where: input.where,
        renderPlan: input.renderPlan,
        sampleContactIds: input.sampleContactIds,
        releaseAt: input.releaseAt,
        trial: input.trial,
        // Ochrana proti segmentu, který se zkompiluje do drahého SQL
        // (část 4a, 7.3, bod 4). Bez stropu drží jedna dávka spojení do vypršení
        // celé úlohy a kampaň se nepohne ani o řádek.
        statementTimeoutMs: MATERIALIZE_STATEMENT_TIMEOUT_MS,
      });
      return { scanned: r.scanned, inserted: r.inserted, nextCursor: r.nextCursor };
    },
    advanceCursor: (input) => advanceCursor(ctx, input),
    readStatus: (campaignId) => loopStatus(ctx, campaignId),
    cleanupCancelled: async (campaignId) => {
      // Úklid se opakuje, dokud UPDATE vrací nenulový počet: mezi kontrolou stavu
      // a koncem dávky se dá stihnout další INSERT.
      const audienceBuiltAt = await withWorkspace(ctx, async (tx) => {
        const r = await tx.execute<{ audience_built_at: string | null }>(
          rawSql(`SELECT audience_built_at FROM campaigns WHERE id = $1 AND workspace_id = $2`, [
            campaignId,
            ctx.workspaceId,
          ]),
        );
        return r.rows[0]?.audience_built_at ?? null;
      });
      if (audienceBuiltAt === null) return 0;
      let skipped = 0;
      for (;;) {
        const n = await cancelPendingBatch(ctx, { campaignId, audienceBuiltAt });
        skipped += n;
        if (n === 0) return skipped;
      }
    },
    now: () => new Date(),
    log: (level, msg, meta) => {
      // Doména kampaní vlastní logger nemá a zakládat ho tady by znamenalo druhý
      // vedle toho, který si worker staví při startu. Řádek jde na stderr, tedy
      // tam, kde ho sbírá kontejner.
      process.stderr.write(`${JSON.stringify({ level, msg, ...(meta as object) })}\n`);
    },
  };
}

/**
 * Závislosti jobu `campaign.materialize`.
 *
 * `workspaceId` přichází V NÁKLADU úlohy, ne z přihlášení: pg-boss doručí holý
 * JSON. Teprve tady z něj vzniká systémový transakční kontext, takže na všechny
 * dotazy dopadá RLS projektu úplně stejně jako na požadavek z API.
 */
export function materializeDeps(payload: MaterializeJobPayload): MaterializeDeps {
  const ctx = createSystemContext(payload.workspaceId, 'campaign.materialize');
  const config = loadConfig();

  return {
    start: async (campaignId) => {
      const settings = await readWorkspaceSettings(ctx);
      return startMaterialization(ctx, campaignId, undoWindowSeconds(settings.campaigns));
    },
    readStatus: (campaignId) => loopStatus(ctx, campaignId),
    progress: async (campaignId) => {
      const p = await getProgress(ctx, campaignId);
      return p === null
        ? null
        : {
            phase: p.phase,
            cursor_contact_id: p.cursor_contact_id,
            inserted_rows: p.inserted_rows,
          };
    },
    compileAudience: async (input) => {
      const audience = await readCampaignAudience(ctx, input.campaignId);
      const where = await buildAudienceSql(audiencePort(ctx, workspaceTimezone()), {
        workspaceId: ctx.workspaceId,
        audience,
        paramOffset: input.paramOffset,
        asOf: input.asOf,
      });
      return { sql: where.sql, params: where.params };
    },
    countGates: async (input) => {
      const audience = await readCampaignAudience(ctx, input.campaignId);
      return campaignAudienceGates(ctx, audience, {
        asOf: input.asOf,
        timezone: workspaceTimezone(),
      });
    },
    setGateCounters: (campaignId, gates) => setGateCounters(ctx, campaignId, gates),
    renderPlan: (campaignId) => readRenderPlan(ctx, campaignId),
    sampleContactIds: async () => {
      const manifest = await withWorkspace(ctx, (tx) => readDemoManifest(tx, ctx.workspaceId));
      return manifest?.contactIds ?? [];
    },
    trialSettings: async (): Promise<ResolvedTrialSettings> => {
      // Přepínač se rozhoduje `readTrialState`, ne tady: výchozí hodnota
      // („zapnuto, dokud není ověřená doména") je pravidlo domény providerů
      // a druhá kopie by se s ní rozešla právě u čerstvého projektu.
      const state = await readTrialState(ctx);
      return { trial_mode: state.trial_mode, trial_verified: state.verified };
    },
    loop: (input) => runMaterializeLoop(loopDeps(ctx), input as unknown as MaterializeLoopInput),
    finish: (campaignId, audienceBuiltAt) =>
      finishMaterialization(ctx, campaignId, audienceBuiltAt),
    pause: async (campaignId, reason) => {
      await pauseCampaign(ctx, campaignId, reason);
    },
    fail: async (campaignId, errorCode) => {
      await transitionStatus(ctx, {
        campaignId,
        to: 'failed',
        from: ['queueing', 'sending'],
        set: {
          finished_at: new Date(),
          last_error: JSON.stringify({ code: errorCode, at: new Date().toISOString() }),
        },
      });
    },
    emit: (input) => emitEvent(ctx, { type: input.type, data: { campaign_id: input.campaignId } }),
    config: {
      batchSize: config.CAMPAIGN_MATERIALIZE_BATCH_SIZE,
      maxMinutes: config.CAMPAIGN_MATERIALIZE_MAX_MINUTES,
    },
  };
}
