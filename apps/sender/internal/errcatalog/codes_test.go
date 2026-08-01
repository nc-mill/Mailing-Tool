package errcatalog

import "testing"

func TestEveryCodeHasAClass(t *testing.T) {
	for _, code := range All() {
		if Class(code) == ClassUnknown {
			t.Errorf("kód %q nemá třídu", code)
		}
	}
}

// credentials_undecryptable je fatal, ne retryable. Fatální třída popisuje osud
// KAMPANĚ (pozastaví se), zatímco osud ZPRÁVY je vrácení na pending. Obojí platí
// zároveň a přesně to dělá varianta D3d.
func TestCredentialsUndecryptableIsFatal(t *testing.T) {
	if Class(CredentialsUndecryptable) != ClassFatal {
		t.Fatalf("třída = %v, chci fatal", Class(CredentialsUndecryptable))
	}
}

func TestPauseCodeMapping(t *testing.T) {
	cases := map[string]string{
		ProviderAuthFailed:             "provider_unavailable",
		SendingPaused:                  "provider_unavailable",
		AccountSuspended:               "provider_unavailable",
		MailFromNotVerified:            "provider_unavailable",
		ProviderEventConfigMissing:     "provider_unavailable",
		SMTPStarttlsUnavailable:        "provider_unavailable",
		SMTPInsecureAuthRefused:        "provider_unavailable",
		ProviderQuotaExceeded:          "provider_quota_exhausted",
		CredentialsUndecryptable:       "credentials_undecryptable",
		ContractMismatch:               "render_failure_rate",
		LiquidEscapedEntityInConstruct: "render_failure_rate",
	}
	for code, want := range cases {
		if got := PauseCode(code); got != want {
			t.Errorf("PauseCode(%s) = %s, chci %s", code, got, want)
		}
	}
}
