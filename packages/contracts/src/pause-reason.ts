/**
 * Tvar objektu campaigns.pause_reason (KONTRAKT, část 1, 4.10.1).
 * Existuje JEDEN tvar, ne dva. Sloupec má typ jsonb a vlastní ho část 4a,
 * ale musí existovat a mít tenhle typ, jinak sender pozastavení neprovede.
 */

export const SENDER_PAUSE_REASON_CODES = [
  'render_failure_rate',
  'credentials_undecryptable',
  'provider_quota_exhausted',
  'provider_unavailable',
] as const;

export const APP_ONLY_PAUSE_REASON_CODES = [
  'user',
  'bounce_guard',
  'complaint_guard',
  'provider_blocked',
  'materialize_timeout',
] as const;

export const PAUSE_REASON_CODES = [
  ...SENDER_PAUSE_REASON_CODES,
  ...APP_ONLY_PAUSE_REASON_CODES,
] as const;

export type PauseReasonCode = (typeof PAUSE_REASON_CODES)[number];
export type PauseReasonSource = 'sender' | 'app' | 'user';

export type PauseReason = {
  code: PauseReasonCode;
  source: PauseReasonSource;
  /** technický text pro log, konkrétní příčina patří sem, ne do code */
  detail?: string;
  /** jen když source = "sender" */
  sender_id?: string;
  /** ISO 8601 v UTC */
  at: string;
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Ověří objekt, který zapisuje SENDER.
 *
 * Omezení míří na sender, ne na kód: aplikace smí zapsat kteroukoliv hodnotu
 * včetně těch čtyř. Kdo zápis provedl, se pozná z pole `source`.
 */
export function assertSenderPauseReason(value: unknown): asserts value is PauseReason {
  if (typeof value !== 'object' || value === null) {
    throw new Error('pause_reason musí být neprázdný objekt');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.code !== 'string') throw new Error('pause_reason.code chybí');
  if (!(SENDER_PAUSE_REASON_CODES as readonly string[]).includes(v.code)) {
    throw new Error(`sender nesmí zapsat pause_reason.code ${v.code}`);
  }
  if (v.source !== 'sender' && v.source !== 'app' && v.source !== 'user') {
    throw new Error('pause_reason.source musí být sender, app nebo user');
  }
  if (typeof v.at !== 'string' || !ISO_UTC.test(v.at)) {
    throw new Error('pause_reason.at musí být ISO 8601 v UTC');
  }
  if (v.detail !== undefined && typeof v.detail !== 'string') {
    throw new Error('pause_reason.detail musí být text');
  }
  if (v.sender_id !== undefined && v.source !== 'sender') {
    throw new Error('pause_reason.sender_id smí být jen při source = sender');
  }
}
