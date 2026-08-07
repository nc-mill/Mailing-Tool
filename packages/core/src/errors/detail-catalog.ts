/**
 * Lokalizované texty pole `detail` v RFC 9457 odpovědi.
 *
 * Rozhodnutí R4 plánu P04: texty jsou zatím tady a ne v packages/i18n, protože
 * i18n infrastrukturu vlastní P05, který ve vlně 0 běží paralelně. Struktura
 * klíčů je záměrně shodná s katalogem (errors.<code>.detail), aby je P06 mohl
 * mechanicky přesunout do packages/i18n/messages/{cs,en}/platform.json.
 *
 * ODCHYLKA OD PLÁNU: plán vypisoval 35 kořenových kódů platformy. Skutečný
 * registr od P01 jich má 123 napříč šesti doménami a test „má text pro každý
 * kód z registru" je proto závazný pro všechny. Doménové texty jsou dopsané
 * podle title a statusu z registru, vždy do OBOU katalogů naráz.
 */
type Catalog = Record<string, string>;

const en: Catalog = {
  // --- Platforma, část 1, kapitola 4.2 --------------------------------------
  unauthenticated: 'Authentication is required.',
  invalid_credentials: 'The e-mail address or password is not correct.',
  session_expired: 'Your session has expired. Sign in again.',
  signature_invalid: 'The request signature could not be verified.',
  forbidden: 'Your role does not allow this action.',
  insufficient_scope: 'The API key does not have the required scope.',
  origin_not_allowed: 'The Origin header does not match the application URL.',
  csrf_token_invalid: 'The CSRF token is missing or does not match.',
  not_found: 'The requested resource does not exist.',
  method_not_allowed: 'This method is not allowed on this path.',
  conflict: 'The resource is in a state that does not allow this operation.',
  already_exists: 'A resource with these values already exists.',
  invalid_state_transition: 'This state transition is not allowed.',
  idempotency_key_reuse: 'The same Idempotency-Key was used with a different body.',
  idempotency_request_in_progress: 'A request with the same Idempotency-Key is still running.',
  last_owner_cannot_be_removed: 'A project must always have exactly one owner.',
  setup_already_completed: 'The installation has already been set up.',
  already_member: 'This user is already a member of the project.',
  signup_closed:
    'This installation does not let invited people create their own account (SIGNUP_MODE=closed). ' +
    'Ask an administrator to create the account for you in Settings, Members.',
  workspace_create_not_allowed:
    'Only the owner of an existing project can create a new one. Ask a project owner to create ' +
    'the project and invite you to it in Settings, Members.',
  webhook_endpoint_disabled: 'The webhook endpoint is disabled and does not accept deliveries.',
  gone: 'The resource has been permanently removed.',
  endpoint_removed: 'This API endpoint has been removed.',
  precondition_failed: 'The If-Match precondition failed.',
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'This Content-Type is not supported by this endpoint.',
  validation_failed: 'The request body did not pass validation.',
  too_many_items: 'The batch contains more items than allowed.',
  unsupported_api_version: 'This API version is not supported.',
  account_locked: 'The account is temporarily locked after failed sign-in attempts.',
  resource_locked: 'The resource is held by another operation.',
  rate_limited: 'Too many requests. Try again later.',
  quota_exceeded: 'The provider quota has been exceeded.',
  internal_error: 'An unexpected error occurred.',
  not_implemented: 'This endpoint is not available in this build.',
  service_unavailable: 'The service is temporarily unavailable.',
  migration_failed: 'The database update failed and the application runs in limited mode.',
  system_mail_unavailable:
    'This installation cannot send system e-mail, so invitations, password resets and address ' +
    'verification will not be delivered. Add a sending account, SES or SMTP, in Settings, Sending.',
  dependency_timeout: 'A dependency did not respond in time.',

  // --- Kampaně a odesílání, část 4a -----------------------------------------
  campaign_locked: 'The campaign is being sent and cannot be changed.',
  campaign_audience_changed: 'The audience changed after the campaign was prepared.',
  campaign_undo_window_expired: 'The window for cancelling this send has already closed.',
  campaign_audience_empty: 'The campaign audience contains no recipients.',
  campaign_audience_all_pending:
    'Everyone in the selected lists is still waiting for confirmation.',
  campaign_audience_too_large: 'The campaign audience exceeds the allowed size.',
  campaign_not_compiled: 'The campaign template has not been compiled yet.',
  campaign_subject_missing: 'The campaign has no subject line.',
  campaign_no_unsubscribe: 'The template does not contain an unsubscribe link.',
  workspace_postal_address_missing:
    'The project has no sender postal address, so the email footer goes out without one.',
  campaign_unknown_merge_field: 'The template references a field that does not exist.',
  campaign_schedule_too_soon: 'The scheduled time is too close to now.',
  campaign_schedule_too_far: 'The scheduled time is too far in the future.',
  campaign_not_sendable: 'The campaign is not in a state that allows sending.',
  campaign_audience_query_too_slow: 'Building the audience took too long and was cancelled.',
  provider_not_ready: 'The sending provider is not configured or not verified.',
  provider_sending_paused: 'Sending through this provider is paused.',
  provider_quota_exceeded: 'The daily quota of the sending provider has been used up.',
  provider_sandbox: 'The provider account is in sandbox mode and only sends to verified addresses.',
  provider_credentials_invalid: 'The provider rejected the stored credentials.',
  provider_smtp_host_unknown: 'The SMTP host name could not be resolved.',
  provider_smtp_connection_refused: 'The SMTP server refused the connection.',
  provider_smtp_tls_invalid: 'The TLS handshake with the SMTP server failed.',
  provider_smtp_auth_failed: 'The SMTP server rejected the user name or password.',
  provider_smtp_timeout: 'The SMTP server did not respond in time.',
  provider_smtp_starttls_unsupported: 'The SMTP server does not offer STARTTLS.',
  provider_smtp_greeting_invalid: 'The SMTP server sent an unexpected greeting.',
  contract_mismatch: 'The compiled template does not match the queued message.',
  domain_dkim_missing: 'DKIM for the sending domain is not verified.',
  domain_spf_missing: 'The sending domain has no SPF record.',
  domain_dmarc_missing: 'The sending domain has no DMARC record.',
  domain_check_rate_limited: 'Domain checks are rate limited. Try again later.',
  test_recipient_suppressed: 'The test recipient is on the suppression list.',
  // --- Transakční pošta přes API -------------------------------------------
  template_kind_not_transactional:
    'The template is not a transactional template. Only transactional templates can be sent through this endpoint.',
  template_not_compilable: 'The template could not be compiled into an e-mail.',
  recipient_suppressed:
    'The address is on the suppression list for a reason that blocks transactional mail too.',
  recipient_unknown:
    'The address is not a contact in this workspace and create_contact is disabled.',
  transactional_data_too_large: 'The data object is larger than the allowed limit.',
  transactional_variable_unknown: 'The template uses a variable that the request did not supply.',
  sender_identity_not_found: 'No sender identity was found for this workspace.',
  sending_not_configured: 'This workspace has no sending account connected yet.',
  test_rate_limited: 'Too many test sends. Try again later.',

  // --- Kontakty, část 2 ------------------------------------------------------
  contact_limit_reached: 'The contact limit for this project has been reached.',

  // --- Obsah, šablony, značka a AI, část 3 ----------------------------------
  template_document_invalid: 'The template document did not pass validation.',
  template_schema_too_new: 'The template was created in a newer version of the application.',
  template_starter_immutable: 'Starter templates cannot be modified. Duplicate one first.',
  template_in_use:
    'A form or a list sends this template. Disconnect it there first, then delete it.',
  /*
   * Blokující nálezy předodesílací kontroly. V katalogu chyběly, takže
   * `resolveDetail` vracela holý kód a editor psal uživateli do panelu
   * „precheck_app_url_not_public". Doplněno ve chvíli, kdy se ty nálezy
   * v editoru poprvé skutečně ukázaly.
   *
   * OPRAVENO: dřív tu stálo, že do REGISTRU kódů nepatří. Do `PROBLEM_CODES`
   * opravdu ne, protože to nejsou kořenové kódy odpovědi a nemají HTTP status,
   * jenže registr má šest druhů a jeden z nich, `FINDING_CODES`, je právě pro
   * položky pole `findings`. Všech devět kódů `precheck_*` v něm od té doby je.
   */
  precheck_template_invalid: 'The template has errors that prevent sending.',
  precheck_missing_unsubscribe: 'The email has no unsubscribe link.',
  precheck_html_too_large: 'The email is too large to send.',
  precheck_subject_empty: 'The subject is empty.',
  precheck_app_url_not_public:
    'The application address is not public, so links in the email would not work for recipients.',
  template_name_conflict: 'A template with this name already exists in the project.',
  content_too_many_blocks: 'The document contains more blocks than allowed.',
  asset_quota_exceeded: 'The storage quota for assets has been used up.',
  asset_too_many_pixels: 'The image has more pixels than allowed.',
  asset_unsupported_format: 'This file format is not supported.',
  asset_corrupt: 'The uploaded file could not be read.',
  asset_referenced_by_sent_campaign: 'The asset is used by a campaign that has already been sent.',
  brand_invalid_url: 'The entered address is not a valid URL.',
  brand_scheme_not_allowed: 'Only http and https addresses are allowed.',
  brand_port_not_allowed: 'This port is not allowed.',
  brand_host_not_allowed: 'This host is not allowed.',
  brand_blocked_address: 'The host resolves to an address that is not allowed.',
  brand_credentials_in_url: 'The address must not contain a user name or password.',
  brand_robots_disallowed: 'The robots.txt of the site disallows fetching this page.',
  brand_robots_unavailable: 'The robots.txt of the site could not be fetched.',
  brand_dns_failed: 'The host name could not be resolved.',
  brand_fetch_failed: 'The page could not be fetched.',
  brand_insecure_redirect: 'The page redirected from https to http.',
  brand_redirect_loop: 'The page redirects in a loop.',
  brand_too_many_redirects: 'The page exceeded the allowed number of redirects.',
  brand_response_too_large: 'The response from the site is too large.',
  brand_unexpected_content_type: 'The site returned an unexpected content type.',
  brand_timeout: 'The site did not respond in time.',
  brand_extract_running: 'Brand extraction for this project is already running.',
  ai_credential_missing: 'No API key is configured for the AI provider.',
  ai_invalid_credentials: 'The AI provider rejected the configured key.',
  ai_insufficient_credit: 'The AI provider account has insufficient credit.',
  ai_context_too_long: 'The request is too long for the selected model.',
  ai_invalid_output: 'The AI returned output in an unexpected shape.',
  ai_content_filtered: 'The AI provider refused to process this content.',
  ai_rate_limited: 'The AI provider rate limited the request. Try again later.',
  ai_provider_unavailable: 'The AI provider is temporarily unavailable.',
  ai_timeout: 'The AI provider did not respond in time.',

  // --- Tracking, část 5 ------------------------------------------------------
  token_malformed: 'The tracking token has an invalid shape.',
  token_signature_invalid: 'The tracking token signature could not be verified.',
  token_unknown_key: 'The tracking token was signed with an unknown key generation.',
  token_type_mismatch: 'The tracking token does not belong to this endpoint.',
  tracking_payload_version_unsupported: 'This tracking payload version is not supported.',
  token_already_used: 'This one time token has already been used.',
  tracking_disabled: 'Tracking is switched off for this project.',
  tracking_merge_not_revertible: 'This identity merge can no longer be reverted.',
  token_expired: 'The tracking token has expired.',
  tracking_domain_invalid: 'The tracking domain is not valid.',
  tracking_domain_limit_reached: 'The limit of tracking domains has been reached.',
  tracking_event_too_large: 'The event payload is too large.',
  tracking_invalid_event_name: 'The event name is not valid.',
  tracking_invalid_anonymous_id: 'The anonymous identifier is not valid.',
  tracking_identify_unsigned_pii: 'Identify may not carry personal data without a signature.',
  tracking_import_beyond_retention: 'The imported events fall outside the retention window.',
  tracking_import_partition_missing: 'The partition for the imported events does not exist.',
  tracking_timeline_window_too_large: 'The requested time window is too large.',

  // --- Sender, část 4b -------------------------------------------------------
  sender_not_running: 'The sending service is not running.',
};

const cs: Catalog = {
  // --- Platforma, část 1, kapitola 4.2 --------------------------------------
  unauthenticated: 'Je potřeba se přihlásit.',
  invalid_credentials: 'E-mail nebo heslo nejsou správně.',
  session_expired: 'Vaše přihlášení vypršelo. Přihlaste se znovu.',
  signature_invalid: 'Podpis požadavku se nepodařilo ověřit.',
  forbidden: 'Vaše role tuhle akci nedovoluje.',
  insufficient_scope: 'API klíč nemá potřebné oprávnění.',
  origin_not_allowed: 'Hlavička Origin neodpovídá adrese aplikace.',
  csrf_token_invalid: 'Chybí nebo nesedí CSRF token.',
  not_found: 'Požadovaný záznam neexistuje.',
  method_not_allowed: 'Tahle metoda není na této cestě povolená.',
  conflict: 'Záznam je ve stavu, který tuhle operaci nedovoluje.',
  already_exists: 'Záznam s těmito hodnotami už existuje.',
  invalid_state_transition: 'Tenhle přechod stavu není povolený.',
  idempotency_key_reuse: 'Stejný Idempotency-Key byl použitý s jiným tělem požadavku.',
  idempotency_request_in_progress: 'Požadavek se stejným Idempotency-Key ještě běží.',
  last_owner_cannot_be_removed: 'Projekt musí mít vždy právě jednoho vlastníka.',
  setup_already_completed: 'Instalace už je nastavená.',
  already_member: 'Tenhle uživatel už je členem projektu.',
  signup_closed:
    'Tahle instalace nedovoluje pozvaným zakládat si účet (SIGNUP_MODE=closed). ' +
    'Požádejte správce, ať vám účet založí v Nastavení, Členové.',
  workspace_create_not_allowed:
    'Nový projekt smí založit jen vlastník některého existujícího projektu. Požádejte vlastníka, ' +
    'ať projekt založí a pozve vás do něj v Nastavení, Členové.',
  webhook_endpoint_disabled: 'Webhook endpoint je vypnutý a doručování nepřijímá.',
  gone: 'Záznam byl trvale odstraněný.',
  endpoint_removed: 'Tenhle endpoint API byl zrušený.',
  precondition_failed: 'Podmínka If-Match neplatí.',
  payload_too_large: 'Tělo požadavku je příliš velké.',
  unsupported_media_type: 'Tenhle Content-Type endpoint nepodporuje.',
  validation_failed: 'Tělo požadavku neprošlo kontrolou.',
  too_many_items: 'Dávka obsahuje víc položek, než je povoleno.',
  unsupported_api_version: 'Tahle verze API není podporovaná.',
  account_locked: 'Účet je dočasně zamčený po neúspěšných pokusech o přihlášení.',
  resource_locked: 'Záznam právě drží jiná operace.',
  rate_limited: 'Příliš mnoho požadavků. Zkuste to za chvíli.',
  quota_exceeded: 'Kvóta poskytovatele je vyčerpaná.',
  internal_error: 'Nastala neočekávaná chyba.',
  not_implemented: 'Tenhle endpoint v této verzi není dostupný.',
  service_unavailable: 'Služba je dočasně nedostupná.',
  migration_failed: 'Aktualizace databáze se nezdařila. Aplikace běží v omezeném režimu.',
  system_mail_unavailable:
    'Instalace nemá čím odeslat systémový e-mail, takže pozvánka, obnova hesla ani ověření ' +
    'adresy nedorazí. Přidejte v Nastavení, Odesílání odesílací účet, typu SES nebo SMTP.',
  dependency_timeout: 'Závislá služba neodpověděla včas.',

  // --- Kampaně a odesílání, část 4a -----------------------------------------
  campaign_locked: 'Kampaň se právě rozesílá a nejde měnit.',
  campaign_audience_changed: 'Publikum se od přípravy kampaně změnilo.',
  campaign_undo_window_expired: 'Lhůta na zrušení rozeslání už uplynula.',
  campaign_audience_empty: 'Publikum kampaně neobsahuje žádného příjemce.',
  campaign_audience_all_pending: 'Všichni ve vybraných seznamech čekají na potvrzení.',
  campaign_audience_too_large: 'Publikum kampaně překračuje povolenou velikost.',
  campaign_not_compiled: 'Šablona kampaně ještě není zkompilovaná.',
  campaign_subject_missing: 'Kampaň nemá vyplněný předmět.',
  campaign_no_unsubscribe: 'Šablona neobsahuje odhlašovací odkaz.',
  workspace_postal_address_missing:
    'Projekt nemá vyplněnou poštovní adresu odesílatele, patička odejde bez ní.',
  campaign_unknown_merge_field: 'Šablona odkazuje na pole, které neexistuje.',
  campaign_schedule_too_soon: 'Naplánovaný čas je příliš blízko.',
  campaign_schedule_too_far: 'Naplánovaný čas je příliš daleko v budoucnosti.',
  campaign_not_sendable: 'Kampaň není ve stavu, ze kterého jde odeslat.',
  campaign_audience_query_too_slow: 'Sestavení publika trvalo příliš dlouho a bylo zrušeno.',
  provider_not_ready: 'Odesílací poskytovatel není nastavený nebo ověřený.',
  provider_sending_paused: 'Odesílání přes tohoto poskytovatele je pozastavené.',
  provider_quota_exceeded: 'Denní kvóta odesílacího poskytovatele je vyčerpaná.',
  provider_sandbox: 'Účet poskytovatele je v sandboxu a odesílá jen na ověřené adresy.',
  provider_credentials_invalid: 'Poskytovatel odmítl uložené přihlašovací údaje.',
  provider_smtp_host_unknown: 'Název SMTP serveru se nepodařilo přeložit.',
  provider_smtp_connection_refused: 'SMTP server odmítl spojení.',
  provider_smtp_tls_invalid: 'Navázání TLS se SMTP serverem selhalo.',
  provider_smtp_auth_failed: 'SMTP server odmítl uživatelské jméno nebo heslo.',
  provider_smtp_timeout: 'SMTP server neodpověděl včas.',
  provider_smtp_starttls_unsupported: 'SMTP server nenabízí STARTTLS.',
  provider_smtp_greeting_invalid: 'SMTP server poslal neočekávané uvítání.',
  contract_mismatch: 'Zkompilovaná šablona neodpovídá zprávě ve frontě.',
  domain_dkim_missing: 'DKIM odesílací domény není ověřený.',
  domain_spf_missing: 'Odesílací doména nemá SPF záznam.',
  domain_dmarc_missing: 'Odesílací doména nemá DMARC záznam.',
  domain_check_rate_limited: 'Kontroly domény jsou omezené. Zkuste to za chvíli.',
  test_recipient_suppressed: 'Testovací příjemce je na seznamu potlačených adres.',
  // --- Transakční pošta přes API -------------------------------------------
  template_kind_not_transactional:
    'Šablona není transakční. Tímhle rozhraním jde odeslat jen transakční šablona.',
  template_not_compilable: 'Šablonu se nepodařilo zkompilovat do e-mailu.',
  recipient_suppressed:
    'Adresa je na seznamu blokovaných z důvodu, který blokuje i transakční poštu.',
  recipient_unknown: 'Adresa v tomhle projektu není kontakt a zakládání kontaktu je vypnuté.',
  transactional_data_too_large: 'Objekt data je větší, než dovoluje limit.',
  transactional_variable_unknown: 'Šablona používá proměnnou, kterou volání nedodalo.',
  sender_identity_not_found: 'Pro tenhle projekt se nenašla žádná odesílací identita.',
  sending_not_configured: 'Projekt zatím nemá připojený odesílací účet.',
  test_rate_limited: 'Příliš mnoho testovacích odeslání. Zkuste to za chvíli.',

  // --- Kontakty, část 2 ------------------------------------------------------
  contact_limit_reached: 'Limit kontaktů pro tenhle projekt je vyčerpaný.',

  // --- Obsah, šablony, značka a AI, část 3 ----------------------------------
  template_document_invalid: 'Dokument šablony neprošel kontrolou.',
  template_schema_too_new: 'Šablona vznikla v novější verzi aplikace.',
  template_starter_immutable: 'Výchozí šablony nejdou měnit. Nejdřív si ji zduplikujte.',
  template_in_use:
    'Tuhle šablonu rozesílá formulář nebo seznam. Nejdřív ji tam odpojte, pak půjde smazat.',
  // Blokující nálezy předodesílací kontroly, viz poznámka u anglického katalogu.
  precheck_template_invalid: 'Šablona má chyby, kvůli kterým ji nejde odeslat.',
  precheck_missing_unsubscribe: 'E-mail nemá odkaz na odhlášení.',
  precheck_html_too_large: 'E-mail je moc velký na odeslání.',
  precheck_subject_empty: 'Předmět je prázdný.',
  precheck_app_url_not_public:
    'Adresa aplikace není veřejná, takže odkazy v e-mailu by příjemcům nefungovaly.',
  template_name_conflict: 'Šablona s tímhle jménem už v projektu je.',
  content_too_many_blocks: 'Dokument obsahuje víc bloků, než je povoleno.',
  asset_quota_exceeded: 'Úložný prostor pro soubory je vyčerpaný.',
  asset_too_many_pixels: 'Obrázek má víc pixelů, než je povoleno.',
  asset_unsupported_format: 'Tenhle formát souboru není podporovaný.',
  asset_corrupt: 'Nahraný soubor se nepodařilo přečíst.',
  asset_referenced_by_sent_campaign: 'Soubor používá kampaň, která už byla odeslaná.',
  brand_invalid_url: 'Zadaná adresa není platná URL.',
  brand_scheme_not_allowed: 'Povolené jsou jen adresy http a https.',
  brand_port_not_allowed: 'Tenhle port není povolený.',
  brand_host_not_allowed: 'Tenhle host není povolený.',
  brand_blocked_address: 'Host se překládá na adresu, která není povolená.',
  brand_credentials_in_url: 'Adresa nesmí obsahovat jméno ani heslo.',
  brand_robots_disallowed: 'Soubor robots.txt na webu stahování téhle stránky zakazuje.',
  brand_robots_unavailable: 'Soubor robots.txt se nepodařilo stáhnout.',
  brand_dns_failed: 'Název hostitele se nepodařilo přeložit.',
  brand_fetch_failed: 'Stránku se nepodařilo stáhnout.',
  brand_insecure_redirect: 'Stránka přesměrovala z https na http.',
  brand_redirect_loop: 'Stránka se přesměrovává dokola.',
  brand_too_many_redirects: 'Stránka překročila povolený počet přesměrování.',
  brand_response_too_large: 'Odpověď z webu je příliš velká.',
  brand_unexpected_content_type: 'Web vrátil neočekávaný typ obsahu.',
  brand_timeout: 'Web neodpověděl včas.',
  brand_extract_running: 'Načítání značky pro tenhle projekt už běží.',
  ai_credential_missing: 'Pro AI poskytovatele není nastavený žádný klíč.',
  ai_invalid_credentials: 'AI poskytovatel odmítl nastavený klíč.',
  ai_insufficient_credit: 'Účet u AI poskytovatele nemá dostatečný kredit.',
  ai_context_too_long: 'Požadavek je pro vybraný model příliš dlouhý.',
  ai_invalid_output: 'AI vrátila výstup v neočekávaném tvaru.',
  ai_content_filtered: 'AI poskytovatel odmítl tenhle obsah zpracovat.',
  ai_rate_limited: 'AI poskytovatel požadavek omezil. Zkuste to za chvíli.',
  ai_provider_unavailable: 'AI poskytovatel je dočasně nedostupný.',
  ai_timeout: 'AI poskytovatel neodpověděl včas.',

  // --- Tracking, část 5 ------------------------------------------------------
  token_malformed: 'Sledovací token má neplatný tvar.',
  token_signature_invalid: 'Podpis sledovacího tokenu se nepodařilo ověřit.',
  token_unknown_key: 'Sledovací token je podepsaný neznámou generací klíče.',
  token_type_mismatch: 'Sledovací token nepatří k tomuhle endpointu.',
  tracking_payload_version_unsupported: 'Tahle verze sledovacích dat není podporovaná.',
  token_already_used: 'Tenhle jednorázový token už byl použitý.',
  tracking_disabled: 'Sledování je pro tenhle projekt vypnuté.',
  tracking_merge_not_revertible: 'Tohle sloučení identit už nejde vrátit zpět.',
  token_expired: 'Platnost sledovacího tokenu vypršela.',
  tracking_domain_invalid: 'Sledovací doména není platná.',
  tracking_domain_limit_reached: 'Limit sledovacích domén je vyčerpaný.',
  tracking_event_too_large: 'Data události jsou příliš velká.',
  tracking_invalid_event_name: 'Název události není platný.',
  tracking_invalid_anonymous_id: 'Anonymní identifikátor není platný.',
  tracking_identify_unsigned_pii: 'Volání identify nesmí nést osobní údaje bez podpisu.',
  tracking_import_beyond_retention: 'Importované události leží mimo dobu uchování.',
  tracking_import_partition_missing: 'Oddíl pro importované události neexistuje.',
  tracking_timeline_window_too_large: 'Požadované časové okno je příliš velké.',

  // --- Sender, část 4b -------------------------------------------------------
  sender_not_running: 'Odesílací služba neběží.',
};

const CATALOGS: Record<string, Catalog> = { en, cs };

/**
 * Vrátí text pro daný kód a jazyk. Fallback je en, pak samotný kód.
 * Vrácení kódu je poznatelný stav a využívá ho test úplnosti katalogu.
 */
export function resolveDetail(code: string, locale: string): string {
  const primary = CATALOGS[locale.split('-')[0] ?? ''];
  return primary?.[code] ?? en[code] ?? code;
}

export const SUPPORTED_DETAIL_LOCALES = Object.keys(CATALOGS);
