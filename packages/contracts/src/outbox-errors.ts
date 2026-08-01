/**
 * Jmenný prostor messages.error_code (KONTRAKT, část 1, 4.10.1).
 *
 * Je to ODDĚLENÝ uzavřený výčet a nemá nic společného s katalogem HTTP chybových
 * kódů ze 4.2. Tahle tabulka NENÍ úplný registr: je to podmnožina, kterou musí
 * znát obě strany, protože na ni navazuje chování nebo report. Úplný registr
 * vzniká sloučením tří zdrojů (tahle tabulka, katalog senderu z části 4b, důvody
 * vyřazení z částí 2 a 4a) a CI ho vynucuje jako CELEK. Kontrola proti téhle
 * tabulce samotné by spadla na první zprávě, kterou sender označí kódem providera.
 */
export const CONTRACT_OUTBOX_ERROR_CODES = [
  'ambiguous_dispatch',
  'render_failed',
  'render_timeout',
  'provider_rejected',
  'provider_unavailable',
  'credentials_undecryptable',
  'invalid_recipient',
  'suppressed',
  'unsubscribed',
  'campaign_cancelled',
  'contact_deleted',
  'contact_anonymized',
  'processing_restricted',
  'contact_status_changed',
  'render_data_too_large',
] as const;

export type ContractOutboxErrorCode = (typeof CONTRACT_OUTBOX_ERROR_CODES)[number];

/** Sloučí kontraktní tabulku s registry ostatních vlastníků. Duplicity nevadí. */
export function mergeOutboxErrorCodes(
  ...sources: readonly (readonly string[])[]
): readonly string[] {
  return Object.freeze([...new Set(sources.flat())]);
}

export function isKnownOutboxErrorCode(code: string, registry: readonly string[]): boolean {
  return registry.includes(code);
}
