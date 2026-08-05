// Barrel domény kampaní. Bez něj se `@mlain/core/campaigns` vůbec nerozřeší, protože
// mapa `exports` balíčku míří na `./src/<domena>/index.ts` a zástupný znak v ní
// pohlcuje lomítka, takže hlubší podcesta se nerozřeší.
//
// Vystavuje se jen to, co potřebují cizí domény a vrstva API. Obsah dorůstá s fázemi
// plánu; tady je fáze A až D.

export * from './constants';
export * from './types';
export * from './state-machine';
export * from './pause-reason';
export * from './settings';
export type {
  AudienceGateCounts,
  AudiencePort,
  TemplatePort,
  SuppressionPort,
  AuditPort,
  OutgoingWebhookPort,
  PortRegistry,
} from './ports';
export { createPortRegistry } from './ports';

export { buildAudienceSql, type BuildAudienceSqlInput } from './audience/build-sql';
export {
  buildRenderData,
  renderDataColumns,
  RENDER_DATA_EXCLUDED_FIELDS,
  type ContactSnapshotSource,
  type RenderDataResult,
} from './audience/render-data';
export { buildPreview, type AudiencePreview, type AudienceSampleRow } from './audience/preview';
export {
  SAMPLE_SOURCE_REF_PATTERN,
  SAMPLE_SOURCE_REF_PREFIX,
  isSampleSourceRef,
} from './audience/sample-guard';

export { ZERO_UUID } from './materialize/plan-constants';
export { decideAfterFailedClaim, type ClaimDecision } from './materialize/plan';
export {
  runMaterializeLoop,
  type LoopDeps,
  type LoopOutcome,
  type MaterializeLoopInput,
} from './materialize/loop';
export { shouldRunFinish, resumeTarget } from './materialize/finish';

export { revokePendingMessages, type RevokeInput } from './outbox/revoke';
export { anonymizeMessages } from './outbox/anonymize';

export { materializeHandler, MATERIALIZE_JOB, type MaterializeDeps } from './jobs/materialize';
export { reconcileHandler, RECONCILE_JOB, type ReconcileDeps } from './jobs/reconcile';

// Fáze E: plánování a ovládání kampaně.
export {
  validateSchedule,
  truncateToMinute,
  isCatchupWindow,
  EDITABLE_WHILE_SCHEDULED,
  type ScheduleValidation,
} from './control/schedule';
export { pauseCampaign, pauseAllForProvider } from './control/pause';
export { resumeCampaign } from './control/resume';
export { cancelCampaign } from './control/cancel';
export { releaseCampaignNow } from './control/release-now';
export { resolveUndoWindow, computeReleaseAt, undoState, type UndoState } from './control/undo';
export {
  schedulerHandler,
  SCHEDULER_JOB,
  SCHEDULE_DELAY_NOTIFY_SECONDS,
  type SchedulerDeps,
} from './jobs/scheduler';
export { watchdogHandler, closingStatus, WATCHDOG_JOB, type WatchdogDeps } from './jobs/watchdog';

// Fáze F: joby vázané na odesílací účty. Doména providerů leží v `@mlain/core/providers`,
// tyhle dva handlery ale ovládají KAMPANĚ, takže patří sem.
export {
  refreshQuotaHandler,
  REFRESH_QUOTA_JOB,
  type RefreshQuotaDeps,
  type RefreshQuotaPayload,
} from './jobs/provider-refresh-quota';
export {
  resumeOnQuotaHandler,
  RESUME_ON_QUOTA_JOB,
  RESUME_ON_QUOTA_SQL,
  type ResumeOnQuotaDeps,
} from './jobs/resume-on-quota';

// Fáze G: překontrolování odesílacích domén.
export {
  domainRecheckHandler,
  DOMAIN_RECHECK_JOB,
  type DomainRecheckDeps,
} from './jobs/domain-recheck';

// Datová vrstva. Vystavuje se schválně: doménové služby ostatních plánů (P07 při
// odhlášení, P11 při výmazu) ji volají místo vlastního UPDATE nad `messages`.
// Fáze J: kompilace kampaně. Jediná cesta, kterou vzniká `compiled_html`,
// `compiled_text`, `compile_meta` a `campaign_links`.
export {
  computeCompiledHash,
  normalizeCompileOutput,
  assertCompileMetaMatches,
  renderPlanFrom,
  isStoredCompileMeta,
  type StoredCompileMeta,
  type CampaignCompilation,
} from './compile';
export {
  compileCampaign,
  renderPlanForCampaign,
  assertCompilationCurrent,
} from './compile-service';
export { applyTemplateToCampaign, type ApplyTemplateResult } from './template-apply';
export {
  replaceCampaignLinks,
  listCampaignLinks,
  type CompiledLink,
  type CampaignLinkRow,
} from './repo/links';

export { rawSql } from './repo/raw-sql';
export {
  getCampaign,
  transitionStatus,
  bumpRevision,
  listRunningCampaignIds,
  readCampaignStatus,
  claimDueCampaigns,
  markScheduleMissed,
  type CampaignRow,
  type TransitionStatusInput,
} from './repo/campaign';
export {
  reconcileHandoverCounters,
  reconcileDeliveryCounters,
  isOutboxDrained,
} from './repo/counters';
export {
  readLiveHandover,
  readLiveDelivery,
  type LiveHandover,
  type LiveDelivery,
} from './repo/live-progress';
export { countWithTimeout, sampleAudience } from './repo/audience';
export {
  startMaterialization,
  finishMaterialization,
  getProgress,
  advanceCursor,
  setGateCounters,
  type AudienceProgress,
} from './repo/audience-progress';
export {
  materializeBatch,
  cancelPendingBatch,
  findOrphanedPending,
  revokePending,
  reconcileSuppressed,
  anonymizeMessages as anonymizeMessagesRepo,
  type MaterializeBatchInput,
  type MaterializeBatchResult,
  type RenderPlan,
  type RevokeReason,
} from './repo/outbox';
