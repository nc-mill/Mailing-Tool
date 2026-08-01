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
