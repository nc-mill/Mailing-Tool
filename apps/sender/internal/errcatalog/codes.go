// Package errcatalog je katalog chybových kódů senderu z části 4b, kapitola 4.2.
//
// error_code je jediné, na co se smí aplikace strojově spolehnout. Sender zapisuje
// jen kód, nikdy přeloženou hlášku: texty vlastní i18n katalog v aplikaci.
package errcatalog

// ErrorClass rozhoduje o osudu zprávy a kampaně.
type ErrorClass int

const (
	ClassUnknown ErrorClass = iota
	// ClassRetryable vede na variantu D3b: zpět na pending s backoffem
	// a se spotřebovaným pokusem. Dopad je jedna zpráva.
	ClassRetryable
	// ClassThrottled vede na variantu D3e: zpět na pending s krátkým backoffem
	// a s VRÁCENÝM pokusem, plus snížení lokálního limitu.
	ClassThrottled
	// ClassPermanent vede na variantu D3c: failed. Dopad je jedna zpráva.
	ClassPermanent
	// ClassFatal vede na variantu D3d: zpět na pending bez započtení pokusu,
	// plus circuit breaker. Dopad je celá kampaň.
	//
	// ŽÁDNÁ chyba třídy Fatal nesmí zprávu označit jako failed. Fatální chyba
	// zastavuje kampaň, ne jednotlivé zprávy.
	ClassFatal
)

func (c ErrorClass) String() string {
	switch c {
	case ClassRetryable:
		return "retryable"
	case ClassThrottled:
		return "throttled"
	case ClassPermanent:
		return "permanent"
	case ClassFatal:
		return "fatal"
	default:
		return "unknown"
	}
}

const (
	RateLimited          = "rate_limited"
	ProviderUnavailable  = "provider_unavailable"
	NetworkError         = "network_error"
	SMTPTemporaryFailure = "smtp_temporary_failure"
	SMTPTLSTemporary     = "smtp_tls_temporary"

	ProviderAuthFailed         = "provider_auth_failed"
	SendingPaused              = "sending_paused"
	AccountSuspended           = "account_suspended"
	MailFromNotVerified        = "mail_from_not_verified"
	ProviderEventConfigMissing = "provider_event_config_missing"
	ProviderQuotaExceeded      = "provider_quota_exceeded"
	SMTPStarttlsUnavailable    = "smtp_starttls_unavailable"
	SMTPInsecureAuthRefused    = "smtp_insecure_auth_refused"
	CredentialsUndecryptable   = "credentials_undecryptable"
	ContractMismatch           = "contract_mismatch"
	// ProviderConfigUnreadable je ČTENÍ řádku odesílacího účtu, které selhalo.
	// Existuje proto, aby se chyba databáze nehlásila jako chyba dešifrování:
	// credentials_undecryptable pošle toho, kdo to vyšetřuje, za SECRET_KEY,
	// zatímco příčina je jinde a klíče jsou v pořádku.
	ProviderConfigUnreadable = "provider_config_unreadable"

	LiquidEscapedEntityInConstruct = "liquid_escaped_entity_in_construct"

	MessageRejected         = "message_rejected"
	SMTPRecipientRejected   = "smtp_recipient_rejected"
	SMTPMessageRejected     = "smtp_message_rejected"
	SMTPPermanentFailure    = "smtp_permanent_failure"
	InvalidRecipient        = "invalid_recipient"
	InvalidRequest          = "invalid_request"
	RenderTimeout           = "render_timeout"
	RenderFailed            = "render_failed"
	SubjectTooLong          = "subject_too_long"
	BodyTooLarge            = "body_too_large"
	MessageTooLarge         = "message_too_large"
	MarkerInjectionDetected = "marker_injection_detected"
	MarkerNotReplaced       = "marker_not_replaced"
	UnsubscribeURLMissing   = "unsubscribe_url_missing"
	MaxAttemptsExceeded     = "max_attempts_exceeded"

	// AmbiguousDispatch zapisuje reaper B, ne klasifikátor.
	AmbiguousDispatch = "ambiguous_dispatch"
	// Suppressed zapisuje dávková kontrola po claimu.
	Suppressed = "suppressed"
)

var classes = map[string]ErrorClass{
	RateLimited:          ClassThrottled,
	ProviderUnavailable:  ClassRetryable,
	NetworkError:         ClassRetryable,
	SMTPTemporaryFailure: ClassRetryable,
	SMTPTLSTemporary:     ClassRetryable,

	ProviderAuthFailed:         ClassFatal,
	SendingPaused:              ClassFatal,
	AccountSuspended:           ClassFatal,
	MailFromNotVerified:        ClassFatal,
	ProviderEventConfigMissing: ClassFatal,
	ProviderQuotaExceeded:      ClassFatal,
	SMTPStarttlsUnavailable:    ClassFatal,
	SMTPInsecureAuthRefused:    ClassFatal,
	CredentialsUndecryptable:   ClassFatal,
	ContractMismatch:           ClassFatal,
	// Fatal ze stejného důvodu jako credentials_undecryptable: osud ZPRÁVY je
	// návrat na pending (varianta D3d), osud KAMPANĚ pozastavení po vyčerpání
	// pokusů. Označit zprávy za failed kvůli chybě čtení z databáze by znamenalo
	// milion nenávratně zkažených zpráv místo minuty zpoždění.
	ProviderConfigUnreadable: ClassFatal,

	LiquidEscapedEntityInConstruct: ClassFatal,

	MessageRejected:         ClassPermanent,
	SMTPRecipientRejected:   ClassPermanent,
	SMTPMessageRejected:     ClassPermanent,
	SMTPPermanentFailure:    ClassPermanent,
	InvalidRecipient:        ClassPermanent,
	InvalidRequest:          ClassPermanent,
	RenderTimeout:           ClassPermanent,
	RenderFailed:            ClassPermanent,
	SubjectTooLong:          ClassPermanent,
	BodyTooLarge:            ClassPermanent,
	MessageTooLarge:         ClassPermanent,
	MarkerInjectionDetected: ClassPermanent,
	MarkerNotReplaced:       ClassPermanent,
	UnsubscribeURLMissing:   ClassPermanent,
	MaxAttemptsExceeded:     ClassPermanent,

	AmbiguousDispatch: ClassPermanent,
	Suppressed:        ClassPermanent,
}

// Class vrací klasifikační třídu kódu.
func Class(code string) ErrorClass { return classes[code] }

// explanations jsou věty PRO LOG SENDERU, ne pro uživatele.
//
// Kontrakt z hlavičky balíčku platí dál: do error_code se zapisuje výhradně kód
// a texty pro uživatele vlastní katalog i18n v aplikaci. Tohle je něco jiného,
// totiž jediný řádek, který v logu odpoví na otázku „co to znamená", aby se
// příčina nemusela hledat v cizím zdrojáku.
//
// Důvod je konkrétní: provider_event_config_missing se čtyři dny objevoval
// v databázi a z kódu ani z logu nešlo poznat, že za ním je odpověď Amazonu
// NotFoundException, tedy že konfigurační sada v účtu vůbec neexistuje.
var explanations = map[string]string{
	RateLimited:         "provider odmítl kvůli překročení sekundové kvóty, zpráva se zkusí znovu za chvíli",
	ProviderUnavailable: "provider je dočasně nedostupný nebo vrátil vnitřní chybu",
	NetworkError:        "síťová chyba nebo vypršel čas volání provideru",

	ProviderAuthFailed: "provider odmítl přístupové údaje, zkontrolujte přístupový klíč a tajemství odesílacího účtu",
	SendingPaused:      "provider má odesílání pozastavené na úrovni účtu",
	AccountSuspended:   "provider účet pozastavil",
	MailFromNotVerified: "zpáteční doména (MAIL FROM) není u provideru ověřená, " +
		"doplňte chybějící DNS záznamy odesílací domény",
	ProviderEventConfigMissing: "konfigurační sada uvedená u odesílacího účtu v účtu AWS NEEXISTUJE " +
		"(Amazon odpověděl NotFoundException); sadu je potřeba u Amazonu založit, bez ní SES nepřijme žádnou zprávu",
	ProviderQuotaExceeded:    "vyčerpaná denní kvóta provideru",
	CredentialsUndecryptable: "konfiguraci odesílacího účtu nejde dešifrovat, nesouhlasí SECRET_KEY",
	ContractMismatch:         "typ odesílacího účtu v databázi nesouhlasí s typem v šifrované konfiguraci",
	ProviderConfigUnreadable: "řádek odesílacího účtu nejde z databáze přečíst; " +
		"klíče a šifrování s tím NEMAJÍ nic společného, hledejte příčinu v databázi a v podrobnosti chyby",

	MessageRejected: "provider zprávu odmítl; u účtu SES v sandboxu to nejčastěji znamená, " +
		"že adresa PŘÍJEMCE není u Amazonu ověřená, protože v sandboxu se doručuje jen na ověřené identity",
	InvalidRecipient:    "adresa příjemce není platná",
	InvalidRequest:      "provider označil požadavek za vadný",
	MessageTooLarge:     "hotová zpráva přesáhla limit velikosti provideru",
	MaxAttemptsExceeded: "vyčerpaný počet pokusů, poslední chyba byla opakovatelná",
	Suppressed:          "adresa je na seznamu vyloučených, zpráva se neodeslala schválně",
	AmbiguousDispatch:   "sender spadl mezi odesláním a zápisem výsledku, osud zprávy je nejistý",
}

// Explain vrací vysvětlující větu ke kódu pro log senderu.
//
// U neznámého kódu vrací prázdný řetězec, aby se do logu nedostal vymyšlený
// popis chyby, kterou katalog nezná.
func Explain(code string) string { return explanations[code] }

// All vrací všechny známé kódy.
func All() []string {
	out := make([]string, 0, len(classes))
	for c := range classes {
		out = append(out, c)
	}
	return out
}

// PauseCode mapuje kód z katalogu na hrubší registr pause_reason.code.
//
// Registr je hrubší schválně: code řídí chování a UI, konkrétní příčina jde
// do detail. Kdyby se každá příčina promítla do code, musela by se každá nová
// chyba providera projednat jako změna zmrazeného kontraktu.
func PauseCode(code string) string {
	switch code {
	case ProviderQuotaExceeded:
		return "provider_quota_exhausted"
	case CredentialsUndecryptable:
		return "credentials_undecryptable"
	case ContractMismatch, LiquidEscapedEntityInConstruct, RenderFailed, RenderTimeout:
		return "render_failure_rate"
	default:
		return "provider_unavailable"
	}
}
