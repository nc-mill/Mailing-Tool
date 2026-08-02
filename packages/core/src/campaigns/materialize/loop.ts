import type { ResolvedTrialSettings } from '../../providers/trial-mode';
import type { RenderPlan } from '../repo/outbox';
import type { KnownCampaignStatus } from '../types';

export type LoopDeps = {
  batch(input: {
    campaignId: string;
    audienceBuiltAt: string;
    cursor: string;
    batchSize: number;
    where: { sql: string; params: unknown[] };
    renderPlan: RenderPlan;
    sampleContactIds: readonly string[];
    releaseAt: string | null;
    trial: ResolvedTrialSettings;
  }): Promise<{ scanned: number; inserted: number; nextCursor: string | null }>;
  advanceCursor(input: { campaignId: string; cursor: string; inserted: number }): Promise<void>;
  readStatus(campaignId: string): Promise<KnownCampaignStatus>;
  cleanupCancelled(campaignId: string): Promise<number>;
  now(): Date;
  log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void;
};

export type LoopOutcome = 'completed' | 'paused' | 'cancelled' | 'timeout' | 'aborted';

export type MaterializeLoopInput = {
  campaignId: string;
  audienceBuiltAt: string;
  startCursor: string;
  batchSize: number;
  maxMinutes: number;
  where: { sql: string; params: unknown[] };
  renderPlan: RenderPlan;
  sampleContactIds: readonly string[];
  releaseAt: string | null;
  /**
   * Zkusebni rezim projektu. Cte se JEDNOU pred smyckou, ne v kazde davce: je to
   * jedno cislo z nastaveni projektu a beh materializace ma stejne jedno publikum
   * urcene k okamziku `audience_built_at`. Prepnuti rezimu uprostred behu tak
   * nerozdeli jednu kampan na dve poloviny s jinym pravidlem.
   */
  trial: ResolvedTrialSettings;
};

export async function runMaterializeLoop(
  deps: LoopDeps,
  input: MaterializeLoopInput,
): Promise<{ outcome: LoopOutcome; inserted: number; cursor: string }> {
  const deadline = deps.now().getTime() + input.maxMinutes * 60_000;
  let cursor = input.startCursor;
  let inserted = 0;

  for (;;) {
    const r = await deps.batch({
      campaignId: input.campaignId,
      audienceBuiltAt: input.audienceBuiltAt,
      cursor,
      batchSize: input.batchSize,
      where: input.where,
      renderPlan: input.renderPlan,
      sampleContactIds: input.sampleContactIds,
      releaseAt: input.releaseAt,
      trial: input.trial,
    });
    inserted += r.inserted;
    if (r.nextCursor) {
      cursor = r.nextCursor;
      await deps.advanceCursor({
        campaignId: input.campaignId,
        cursor,
        inserted: r.inserted,
      });
    }

    /**
     * Kontrola stavu po kazde davce NENI optimalizace, je to jedina ochrana proti
     * zavodu z 3.6.3.1: bez ni bezici davka po uklidu zrusene kampane vlozi dalsi
     * pending radky, ktere uz nikdo neclaimne a ktere navecky brani odpojeni oddilu.
     */
    const status = await deps.readStatus(input.campaignId);
    if (status === 'paused') return { outcome: 'paused', inserted, cursor };
    if (status === 'cancelled') {
      // Kontrola stavu i zastaveni smycky jsou samy o sobe zavod: mezi kontrolou
      // a koncem davky se da stihnout dalsi INSERT. Uklid se proto opakuje.
      await deps.cleanupCancelled(input.campaignId);
      return { outcome: 'cancelled', inserted, cursor };
    }
    if (status !== 'queueing' && status !== 'sending') {
      deps.log('warn', 'materializace zastavena, kampan je v neocekavanem stavu', {
        campaignId: input.campaignId,
        status,
      });
      return { outcome: 'aborted', inserted, cursor };
    }

    if (!r.nextCursor) return { outcome: 'completed', inserted, cursor };

    if (deps.now().getTime() > deadline) {
      return { outcome: 'timeout', inserted, cursor };
    }
  }
}
