/**
 * Tvar odpovědi `/api/v1/system-mail/status`.
 *
 * Typ je opsaný, ne importovaný z `@mlain/core`: obrazovka mluví s API přes
 * HTTP a hlídá to test kontraktu nad `openapi.json`, ne sdílený typ. Stejný
 * vzor jako u `MemberRow` v `features/members`.
 */
export type SystemMailReason = 'no_account' | 'provider_unsupported' | 'selected_account_missing';

export type SystemMailFromSource = 'configured' | 'verified_domain' | 'app_url';

export type SystemMailAccount = {
  id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  /** Umí tímhle účtem systémová pošta odejít? Dnes jen účty typu SMTP. */
  capable: boolean;
  domain: string | null;
};

export type SystemMailStatus = {
  available: boolean;
  reason: SystemMailReason | null;
  provider_id: string | null;
  provider_type: string | null;
  from_address: string;
  from_source: SystemMailFromSource;
  capable_types: string[];
  settings: { provider_id: string | null; from_address: string | null };
  accounts: SystemMailAccount[];
};

/** Hodnota položky „vybrat automaticky". Prázdný řetězec Radix jako hodnotu nebere. */
export const AUTO_PROVIDER = 'auto';
