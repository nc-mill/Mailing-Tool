/**
 * Doménové chybové kódy vlastněné částí 2. Registrují se do registru chyb, který vlastní P01.
 * Tvar je <domena>_<problem> podle konvence 4.2 části 1.
 *
 * Test kódu na duplicitu napříč celým API běží v P01. Tenhle soubor je zdroj, ne kopie.
 */
export type ErrorCodeMeta = {
  /** HTTP status, se kterým se kód vrací. */
  status: number;
  /** Stabilní anglický title podle RFC 9457. Nikdy se nepřekládá. */
  title: string;
  /** Má smysl zopakovat tentýž požadavek beze změny vstupu? */
  retryable: boolean;
};

export const CONTACTS_ERROR_CODES = {
  contact_suppressed: {
    status: 409,
    title: 'Contact is suppressed',
    retryable: false,
  },
  contact_limit_reached: {
    status: 429,
    title: 'Contact limit reached',
    retryable: false,
  },
  subscribe_blocked_suppressed: {
    status: 409,
    title: 'Subscription blocked by suppression list',
    retryable: false,
  },
  subscribe_blocked_complaint: {
    status: 409,
    title: 'Subscription blocked by spam complaint',
    retryable: false,
  },
  suppression_not_removable: {
    status: 403,
    title: 'Suppression cannot be removed',
    retryable: false,
  },
  suppression_too_recent: {
    status: 409,
    title: 'Suppression is too recent to remove',
    retryable: false,
  },
  field_limit_reached: {
    status: 422,
    title: 'Custom field limit reached',
    retryable: false,
  },
  indexed_field_limit_reached: {
    status: 422,
    title: 'Indexed field limit reached',
    retryable: false,
  },
  field_type_immutable: {
    status: 409,
    title: 'Custom field type cannot be changed',
    retryable: false,
  },
  field_used_by_scheduled_campaign: {
    status: 409,
    title: 'Field is used by a scheduled campaign',
    retryable: false,
  },
  gdpr_not_verified: {
    status: 403,
    title: 'GDPR request is not verified',
    retryable: false,
  },
  retention_below_minimum: {
    status: 422,
    title: 'Retention period is below the minimum',
    retryable: false,
  },
  contact_in_running_campaign: {
    status: 409,
    title: 'Contact is in a running campaign',
    retryable: true,
  },
  list_name_taken: {
    status: 409,
    title: 'List name is already taken',
    retryable: false,
  },
  confirmation_resend_too_soon: {
    status: 429,
    title: 'Confirmation e-mail was sent too recently',
    retryable: true,
  },
  confirmation_resend_limit: {
    status: 429,
    title: 'Confirmation resend limit reached',
    retryable: true,
  },
} as const satisfies Record<string, ErrorCodeMeta>;

export type ContactsErrorCode = keyof typeof CONTACTS_ERROR_CODES;

/**
 * Kódy, které se objevují v errors[].code u validation_failed, tedy na úrovni pole,
 * ne na kořeni odpovědi. Nemají vlastní HTTP status, protože ho určuje validation_failed.
 */
export const CONTACTS_FIELD_ERROR_CODES = [
  'invalid_email',
  'email_too_long',
  'invalid_number',
  'invalid_boolean',
  'invalid_date',
  'invalid_enum_value',
  'value_too_long',
  'required_field_missing',
  'unknown_field_key',
  'field_key_reserved',
  'attributes_too_large',
  'email_taken_by_live_contact',
  'number_format_ambiguous',
  'excel_serial_date_assumed',
  'mapping_required_missing',
  // Šablona připojovaná jako POTVRZOVACÍ e-mail seznamu neobsahuje odkaz
  // `{{ data.confirm_url }}`. Přihlášení by z takového e-mailu nešlo dokončit
  // a nic by přitom nespadlo: render s `strictVariables: false` by z chybějící
  // proměnné udělal prázdný `href`. Viz `lists/confirm-link-guard.ts`.
  'confirmation_template_missing_confirm_link',
  // Uvítací nebo rozloučovací e-mail seznamu obsahuje odhlašovací odkaz. Zpráva
  // odchází jako transakční a sender u toho druhu odhlašovací odkaz nevyrábí,
  // takže by `{{ unsubscribe_url }}` skončil jako prázdný `href`. Že to blokuje
  // uložení a není to varování, rozhodl vedoucí týmu 5. 8. 2026.
  'subscription_email_has_unsubscribe_link',
] as const;

export type ContactsFieldErrorCode = (typeof CONTACTS_FIELD_ERROR_CODES)[number];
