import { OPEN_CAP_PER_MESSAGE_PER_DAY } from '../config';
import { recordOpen, recordTokenInvalid, trackingMetrics } from '../metrics';
import type { OpenClass } from '../types';
import { verifyTrackingToken } from '../tokens/verify';
import type { TrackingKeyring } from '../tokens/keyring';
import { classifyOpen, isPersistedOpenClass } from './classify-open';
import type { ProxyRangeIndex } from './proxy-ranges';

export type BufferedOpen = {
  kind: 'open';
  workspaceId: string;
  messageId: string;
  messageCreatedAt: number;
  occurredAt: Date;
  openClass: OpenClass;
  country: string | null;
};

export type OpenRequest = {
  token: string;
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  now: Date;
  country?: string | null;
};

export type OpenHandlerDeps = {
  keyring: TrackingKeyring;
  proxyRanges: ProxyRangeIndex;
  push: (item: BufferedOpen) => void;
};

/** Strop na dvojici zpráva a třída, viz úvod Tasku 14. */
const CAP_PER_MESSAGE_AND_CLASS = OPEN_CAP_PER_MESSAGE_PER_DAY / 2;

type CapKey = string;

export function createOpenHandler(deps: OpenHandlerDeps): (request: OpenRequest) => void {
  const caps = new Map<CapKey, { day: string; count: number }>();

  return function handleOpen(request: OpenRequest): void {
    const result = verifyTrackingToken(request.token, ['o'], {
      keyring: deps.keyring,
      now: request.now,
    });
    if (!result.ok) {
      recordTokenInvalid(result.code);
      return; // odpověď je vždy GIF, o neplatnosti se volající nedozví
    }
    if (result.fields.type !== 'o') return;

    const openClass = classifyOpen({
      userAgent: request.userAgent,
      method: request.method,
      headers: request.headers,
      ip: request.ip,
      proxyRanges: deps.proxyRanges,
    });
    recordOpen(openClass);

    // Crawler se neukládá vůbec, viz 3.3.4.
    if (!isPersistedOpenClass(openClass)) return;

    const day = request.now.toISOString().slice(0, 10);
    const key: CapKey = `${result.fields.messageId}:${openClass}`;
    const cap = caps.get(key);
    if (cap === undefined || cap.day !== day) {
      caps.set(key, { day, count: 1 });
    } else if (cap.count >= CAP_PER_MESSAGE_AND_CLASS) {
      trackingMetrics.openCapped.inc();
      return;
    } else {
      cap.count += 1;
    }

    deps.push({
      kind: 'open',
      workspaceId: result.fields.workspaceId,
      messageId: result.fields.messageId,
      messageCreatedAt: result.fields.messageCreatedAt,
      occurredAt: request.now,
      openClass,
      country: request.country ?? null,
    });
  };
}
