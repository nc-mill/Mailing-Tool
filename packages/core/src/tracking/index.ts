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
  TrackingTokenType,
  UnsubscribeTokenFields,
  WebEventRef,
} from './types';
export { EVENT_NAME_RE, EVENT_SOURCES, OPEN_CLASS_BIT } from './types';

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

export { insertMessageEvents } from './repo/message-events.repo';
export type { MessageEventInsert } from './repo/message-events.repo';

export { createPublicTrackingRoutes } from './api/public-tracking.routes';
export type { PublicTrackingDeps } from './api/public-tracking.routes';
