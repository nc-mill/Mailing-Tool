export type {
  ClickClass,
  ClickTokenFields,
  EventContext,
  EventPage,
  EventSource,
  IdentityTokenFields,
  MessageRef,
  OpenClass,
  OpenTokenFields,
  TokenErrorCode,
  TrackingTokenFields,
  SystemLinkKind,
  TrackingTokenType,
  UnsubscribeTokenFields,
  WebEventRef,
} from './types';
export {
  EVENT_NAME_RE,
  EVENT_SOURCES,
  OPEN_CLASS_BIT,
  SYSTEM_CLICK_SUBTYPE,
  SYSTEM_LINK_KINDS,
} from './types';

/**
 * Veřejný povrch domény. `apps/web` se do `packages/core` dostane jedině přes
 * tenhle soubor: exportní mapa balíčku nemá vzor `./tracking/*`, takže hlubší
 * cesta se z aplikace naimportovat nedá a nemá.
 */
export { TrackingSettingsSchema, DEFAULT_TRACKING_SETTINGS } from './settings';
export type { TrackingSettings } from './settings';
export {
  OPEN_CAP_PER_MESSAGE_PER_DAY,
  OPEN_DEDUP_WINDOW_SECONDS,
  TRACKING_DOMAIN_LIMIT,
  WEB_EVENT_DEDUP_WINDOW_DAYS,
  trackingConfig,
} from './config';
export type { TrackingConfig } from './config';
export { TRACKING_METRIC_NAMES, trackingMetrics } from './metrics';

export { buildTrackingKeyring, currentTrackingKeyId, deriveTrackingKey } from './tokens/keyring';
export type { TrackingKeyring } from './tokens/keyring';
export { PAYLOAD_BYTES, TOKEN_CHARS } from './tokens/codec';
export { verifyTrackingToken } from './tokens/verify';
export type { VerifyResult } from './tokens/verify';
export { mintIdentityToken } from './tokens/mint';
export type { MintIdentityTokenInput, MintedIdentityToken } from './tokens/mint';
export { lookupMessage } from './tokens/message-lookup';

export { PIXEL_GIF, PIXEL_HEADERS } from './open/gif';
export { ProxyRangeIndex, APPLE_FIXED_CIDR } from './open/proxy-ranges';
export type { ProxyRange, ProxyProvider } from './open/proxy-ranges';
export { classifyOpen, isPersistedOpenClass, isVerifiedOpenClass } from './open/classify-open';
export { createOpenHandler } from './open/handle-open';
export type { BufferedOpen, OpenRequest } from './open/handle-open';

export { TtlLru } from './click/lru';
export { LinkCache } from './click/link-cache';
export { appendQueryParam } from './click/append-query';
export {
  ScannerWindow,
  classifyClickHot,
  isCountedClickClass,
  reclassifyClicks,
} from './click/classify-click';
export { createClickHandler, EXPIRED_PATH, REDIRECT_HEADERS } from './click/handle-click';
export type { BufferedClick, ClickRequest, ClickResponse } from './click/handle-click';

export { TrackingDomainCache, normalizeHost, originHost } from './domains/domain-cache';

export { EventBuffer } from './writer/event-buffer';
export type { EventBufferOptions } from './writer/event-buffer';
export { flushTrackingEvents } from './writer/flush';
export type { BufferedTrackingEvent } from './writer/flush';

export { insertMessageEvents } from './repo/message-events.repo';
export type { MessageEventInsert } from './repo/message-events.repo';

/**
 * Zápis odhlášení jako události kampaně. Volá ho veřejná stránka odhlášení
 * a one-click POST; bez něj se odhlášení ve statistice kampaně neobjeví,
 * i když je v `list_subscriptions` vidět.
 */
export { recordCampaignUnsubscribe } from './unsubscribe/record';
export type { RecordUnsubscribeInput, RecordUnsubscribeResult } from './unsubscribe/record';

/**
 * Proklik na systémový odkaz z patičky. Volají ho veřejné stránky `/u/`, `/p/`
 * a `/v/`, protože ty nevedou přes `/t/c/` a do měření se jinak nedostanou.
 */
export { recordSystemLinkClick, readSystemLinkClicks } from './system-links/record';
export type {
  RecordSystemLinkClickInput,
  RecordSystemLinkClickResult,
  SystemLinkClickCounts,
} from './system-links/record';

// Rozhraní I→P10.1. Provozní příkaz `mlain rebuild-engagement` z P16 si tuhle
// funkci načítá jménem přes tenhle barrel, takže reexport není kosmetika.
export { recomputeContactEngagement } from './repo/contact-engagement.repo';
export type {
  RecomputeEngagementBatch,
  RecomputeEngagementInput,
} from './repo/contact-engagement.repo';

export { createPublicTrackingRoutes } from './api/public-tracking.routes';
export type { PublicTrackingDeps } from './api/public-tracking.routes';

/**
 * Příjem webových událostí, tedy povrch `/e/**`. Do `apps/web` se dostane
 * jedině přes tenhle barrel, exportní mapa balíčku hlubší cestu nemá.
 */
export { createPublicEventRoutes } from './api/public-events.routes';
export type { PublicEventDeps } from './api/public-events.routes';
export { createSdkResponder } from './api/serve-sdk';
export type { SdkResponderDeps } from './api/serve-sdk';
export { createIngestService } from './ingest/ingest-service';
export type {
  EventProcessPayload,
  IngestRequestMeta,
  IngestResponse,
  IngestServiceDeps,
  PreparedEvent,
} from './ingest/ingest-service';
export { createIdentifyService } from './ingest/consume-token';
export type { IdentifyResponse, IdentifyServiceDeps } from './ingest/consume-token';
export { resolvePublicKey, resetPublicKeyCache } from './ingest/public-key';
export type { PublicKeyOwner } from './ingest/public-key';
export {
  MAX_EVENTS_PER_BATCH,
  SUPPORTED_PAYLOAD_VERSIONS,
  parseBatch,
  IngestBatchSchema,
  IngestEventSchema,
} from './ingest/schema';
export type { IngestBatch, IngestEvent } from './ingest/schema';
export { DEFAULT_STRIP_PARAMS, extractCampaign, sanitizeUrl } from './ingest/sanitize-url';
export { sanitizeProperties } from './ingest/sanitize-properties';
export type { Finding, PropertyLimits } from './ingest/sanitize-properties';
export { correctOccurredAt } from './ingest/clock-skew';
export { EVENT_PROCESS_QUEUE, handleEventProcess } from './ingest/event-process';
export type { EventProcessJobData } from './ingest/event-process';
export { enqueueEventBatch, readTrackingSettings } from './ingest/enqueue-batch';
export { classifyTrackingDomain, isTrackingDomainUnreachable } from './ingest/domain-reach';
export type { DomainReach } from './ingest/domain-reach';

/** Obrazovka „Nastavení → Měření". */
export {
  addTrackingDomain,
  ensurePublicTrackingKey,
  listTrackingDomains,
  originMatches,
  readAllowedOrigins,
  readWebTrackingStatus,
  removeTrackingDomain,
} from './ingest/settings-service';
export type {
  AddDomainResult,
  AllowedOrigin,
  PublicTrackingKey,
  TrackingDomainRow,
  WebTrackingStatus,
} from './ingest/settings-service';

export { bindIdentity } from './identity/bind';
export type { BindIdentityInput, BindOutcome } from './identity/bind';
