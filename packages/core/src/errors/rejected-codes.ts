import type { RejectedCodeEntry } from './types';

/**
 * Kódy, které specifikace výslovně odmítla zavést. Test v registru ověří,
 * že žádný z nich v žádném druhu registru není. Bez toho by šlo rozhodnutí
 * obejít prostým přidáním řádku.
 */
export const REJECTED_CODES: readonly RejectedCodeEntry[] = [
  {
    code: 'sns_signature_invalid',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "bad_signature"',
  },
  {
    code: 'sns_cert_url_invalid',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "cert_url_not_allowed"',
  },
  {
    code: 'sns_topic_mismatch',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "topic_mismatch"',
  },
  {
    code: 'campaign_not_found',
    reason: 'nevede klienta k jiné akci než obecný kód (test z části 1, 4.2)',
    useInstead: 'not_found',
  },
  {
    code: 'campaign_invalid_transition',
    reason: 'duplikuje platformní kód',
    useInstead: 'invalid_state_transition',
  },
  {
    code: 'ses_configuration_set_missing',
    reason: 'prefix providera u obecného pojmu (část 4b, 4.2, poznámka 3)',
    useInstead: 'provider_event_config_missing',
  },
  {
    code: 'ses_daily_quota_exceeded',
    reason: 'prefix providera u obecného pojmu (část 4b, 4.2, poznámka 3)',
    useInstead: 'provider_quota_exceeded',
  },
];
