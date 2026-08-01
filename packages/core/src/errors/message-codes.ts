import type { MessageCodeEntry } from './types';

/**
 * Hodnoty sloupce messages.error_code. Sender zapisuje jen kód, nikdy
 * přeloženou hlášku. Třída rozhoduje o tom, co udělá aplikace:
 *   retryable  = zpráva se zkusí znovu
 *   permanent  = zpráva končí na failed, kampaň běží dál
 *   fatal      = kampaň se pozastaví
 *   contract   = kontraktní stav nejistoty, opravuje ho příchozí událost
 *
 * POZOR na rozpor P1.17 z části 4b: kontrakt 4.10.1 vede v
 * packages/contracts/src/outbox-errors.ts užší registr než tenhle katalog.
 * Sladění vlastní P02 a P09, tenhle registr je úplný katalog části 4b.
 */
export const MESSAGE_CODES: readonly MessageCodeEntry[] = [
  { code: 'rate_limited', class: 'retryable', source: 'spec' },
  { code: 'provider_unavailable', class: 'retryable', source: 'spec' },
  { code: 'network_error', class: 'retryable', source: 'spec' },
  { code: 'smtp_temporary_failure', class: 'retryable', source: 'spec' },
  { code: 'smtp_tls_temporary', class: 'retryable', source: 'spec' },
  { code: 'provider_auth_failed', class: 'fatal', source: 'spec' },
  { code: 'sending_paused', class: 'fatal', source: 'spec' },
  { code: 'account_suspended', class: 'fatal', source: 'spec' },
  { code: 'mail_from_not_verified', class: 'fatal', source: 'spec' },
  { code: 'provider_event_config_missing', class: 'fatal', source: 'spec' },
  { code: 'provider_quota_exceeded', class: 'fatal', source: 'spec' },
  { code: 'smtp_starttls_unavailable', class: 'fatal', source: 'spec' },
  { code: 'smtp_insecure_auth_refused', class: 'fatal', source: 'spec' },
  { code: 'credentials_undecryptable', class: 'fatal', source: 'spec' },
  { code: 'contract_mismatch', class: 'fatal', source: 'spec' },
  { code: 'liquid_escaped_entity_in_construct', class: 'fatal', source: 'spec' },
  { code: 'message_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_recipient_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_message_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_permanent_failure', class: 'permanent', source: 'spec' },
  { code: 'invalid_recipient', class: 'permanent', source: 'spec' },
  { code: 'invalid_request', class: 'permanent', source: 'spec' },
  { code: 'render_failed', class: 'permanent', source: 'spec' },
  { code: 'render_timeout', class: 'permanent', source: 'spec' },
  { code: 'subject_too_long', class: 'permanent', source: 'spec' },
  { code: 'body_too_large', class: 'permanent', source: 'spec' },
  { code: 'message_too_large', class: 'permanent', source: 'spec' },
  { code: 'marker_injection_detected', class: 'permanent', source: 'spec' },
  { code: 'marker_not_replaced', class: 'permanent', source: 'spec' },
  { code: 'unsubscribe_url_missing', class: 'permanent', source: 'spec' },
  { code: 'max_attempts_exceeded', class: 'permanent', source: 'spec' },
  { code: 'suppressed', class: 'permanent', source: 'spec' },
  { code: 'ambiguous_dispatch', class: 'contract', source: 'spec' },
];
