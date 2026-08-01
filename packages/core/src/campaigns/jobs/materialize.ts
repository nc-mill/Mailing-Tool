import { decideAfterFailedClaim } from '../materialize/plan';
import { shouldRunFinish } from '../materialize/finish';
import { ZERO_UUID } from '../materialize/plan-constants';
import { buildPauseReason, type PauseReason } from '../pause-reason';
import type { AudienceGateCounts } from '../ports';
import type { RenderPlan } from '../repo/outbox';
import type { KnownCampaignStatus } from '../types';

export const MATERIALIZE_JOB = {
  queue: 'campaign.materialize' as const,
  /**
   * pg-boss singletonKey zabranuje dvema soubeznym jobum se stejnym klicem.
   * NEGARANTUJE, ze job probehne prave jednou: job, ktery spadne nebo vyprsi,
   * se podle retryLimit spusti znovu. Proto jsou ochrany proti duplicite tri
   * (prechod stavu, singletonKey, unikatni index) a kazda sama o sobe staci.
   */
  singletonKey: (campaignId: string) => `campaign.materialize:${campaignId}`,
  retryLimit: 5,
  retryBackoff: true,
  expireInSeconds: 3 * 60 * 60,
};

export type MaterializeDeps = {
  /** Vraci i release_at, protoze ho startMaterialization pocita ve stejnem UPDATE (D12). */
  start(campaignId: string): Promise<{
    audienceBuiltAt: string | null;
    releaseAt?: string | null;
    claimed: boolean;
  }>;
  readStatus(campaignId: string): Promise<string>;
  progress(campaignId: string): Promise<{
    phase: string;
    cursor_contact_id: string | null;
    inserted_rows: number;
  } | null>;
  /**
   * `paramOffset` je POVINNY. Materializacni dotaz ma $1 az $5 obsazene pevnymi
   * parametry, takze poddotaz publika musi zacinat od $6. Bez toho by se cisla
   * parametru prekryla a dotaz by dosadil workspace_id tam, kde ma byt segment.
   */
  compileAudience(input: {
    campaignId: string;
    asOf: Date;
    paramOffset: number;
  }): Promise<{ sql: string; params: unknown[] }>;
  countGates(input: { campaignId: string; asOf: Date }): Promise<AudienceGateCounts>;
  /** Uklada TRI agregaty do ukazatele postupu a CELY jedenactiklicovy rozpad do kampane. */
  setGateCounters(campaignId: string, gates: AudienceGateCounts): Promise<void>;
  /** Plan pro render z ULOZENE compile_meta. Bez nej by render_data nemela `_present`. */
  renderPlan(campaignId: string): Promise<RenderPlan>;
  /**
   * Identifikatory ukazkovych kontaktu z manifestu P16. Cte se JEDNOU pred smyckou:
   * manifest ma nizke desitky polozek a v davce by se cetl zbytecne znovu.
   */
  sampleContactIds(): Promise<string[]>;
  loop(input: Record<string, unknown>): Promise<{
    outcome: string;
    inserted: number;
    cursor: string;
  }>;
  finish(campaignId: string, audienceBuiltAt: string): Promise<boolean>;
  pause(campaignId: string, reason: PauseReason): Promise<void>;
  fail(campaignId: string, errorCode: string): Promise<void>;
  emit(input: { type: string; campaignId: string }): Promise<void>;
  config?: { batchSize: number; maxMinutes: number };
};

/** Materializacni dotaz ma $1..$5 pevne, publikum tedy zacina od $6. */
const AUDIENCE_PARAM_OFFSET = 5;

/**
 * Naklad jobu z fronty `campaign.materialize`.
 *
 * `workspaceId` je tady OBSAH nakladu, ne autorizace: pg-boss doruci holy JSON a teprve
 * z nej si volajici postavi transakcni kontext. Pojmenovany typ existuje proto, ze
 * `scope.test.ts` zakazuje exportovane funkci mimo `packages/core/src/tx` mit
 * `workspaceId: string` primo v seznamu parametru; vzor je `IssueUnsubscribeTokenInput`
 * v domene kontaktu.
 */
export type MaterializeJobPayload = {
  campaignId: string;
  workspaceId: string;
};

export async function materializeHandler(
  deps: MaterializeDeps,
  payload: MaterializeJobPayload,
): Promise<void> {
  const { campaignId } = payload;
  const started = await deps.start(campaignId);

  if (!started.claimed) {
    const status = (await deps.readStatus(campaignId)) as KnownCampaignStatus;
    const decision = decideAfterFailedClaim(status);
    if (decision.action !== 'continue') return;
  }
  if (!started.audienceBuiltAt) return;

  const asOf = new Date(started.audienceBuiltAt);
  const progress = await deps.progress(campaignId);

  // Rozpad po branach se uklada JEDNOU, pred prvni davkou, s asOf = audience_built_at.
  // Pozdejsi cislo by uz videlo jine publikum a rozeslo by se s tim, co doopravdy odeslo.
  // Uklada se CELY, ne slity do tri cisel: cast 6 v 8.6.2 vyslovne zakazuje, aby byl
  // radek "Vyloučeno" souhrnny, a slitim ctyr bran do jedne se souhrnnym zase stane.
  const gates = await deps.countGates({ campaignId, asOf });
  await deps.setGateCounters(campaignId, gates);

  // Plan pro render musi byt nacteny PRED prvni davkou. Kdyz kampan neni zkompilovana,
  // materializace se nesmi rozjet: vznikly by radky s render_data bez `_present`
  // a kazdy podmineny blok by se v odeslanem mailu tise skryl (R11 planu P08).
  let renderPlan: RenderPlan;
  try {
    renderPlan = await deps.renderPlan(campaignId);
  } catch {
    await deps.fail(campaignId, 'campaign_not_compiled');
    return;
  }

  // Ukazkove kontakty se nacitaji pred smyckou, ne v davce. Ochrana stoji na manifestu
  // I na znacce: znacku muze uzivatel prepsat, manifest ne. Viz rozhodnuti A1 planu P16.
  const sampleContactIds = await deps.sampleContactIds();

  const where = await deps.compileAudience({
    campaignId,
    asOf,
    paramOffset: AUDIENCE_PARAM_OFFSET,
  });
  const cfg = deps.config ?? { batchSize: 5000, maxMinutes: 60 };

  const result = await deps.loop({
    campaignId,
    audienceBuiltAt: started.audienceBuiltAt,
    startCursor: progress?.cursor_contact_id ?? ZERO_UUID,
    batchSize: cfg.batchSize,
    maxMinutes: cfg.maxMinutes,
    where,
    renderPlan,
    sampleContactIds,
    // Undo okno spocital startMaterialization ve stejnem UPDATE, ktery zabral kampan.
    // Drive tahle hodnota prisla z deps.config, ktery nikdo nikdy nenaplnil, takze
    // release_at bylo vzdy null a okno na zruseni fakticky neexistovalo.
    releaseAt: started.releaseAt ?? null,
  });

  if (result.outcome === 'timeout') {
    await deps.pause(
      campaignId,
      buildPauseReason('materialize_timeout', 'app', {
        detail: `Materializace překročila strop ${cfg.maxMinutes} minut, kurzor zůstal na ${result.cursor}.`,
      }),
    );
    return;
  }

  if (shouldRunFinish(result.outcome as never)) {
    const finished = await deps.finish(campaignId, started.audienceBuiltAt);
    if (finished) await deps.emit({ type: 'campaign.sending_started', campaignId });
  }
}
