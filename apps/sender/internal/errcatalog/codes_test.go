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

// Vysvětlující věty jsou pojistka proti tomu, co stálo čtyři dny hledání:
// sender čtyři dny zamítal každou zprávu kódem provider_event_config_missing
// a z kódu samotného nešlo poznat, že za ním je chybějící konfigurační sada
// v účtu AWS. Věta se drží testem, aby nezmizela a nezůstala prázdná.
func TestExplainCoversCodesThatStopSending(t *testing.T) {
	// Kódy, u kterých bez vysvětlení nejde poznat, co se má opravit.
	musi := []string{
		ProviderEventConfigMissing,
		MessageRejected,
		ProviderAuthFailed,
		MailFromNotVerified,
		CredentialsUndecryptable,
		ProviderQuotaExceeded,
	}
	for _, code := range musi {
		got := Explain(code)
		if got == "" {
			t.Errorf("kód %q nemá vysvětlení, přitom bez něj nejde poznat, co opravit", code)
			continue
		}
		if len(got) < 30 {
			t.Errorf("vysvětlení kódu %q je jen %q, to není věta", code, got)
		}
	}
}

// Neznámý kód nesmí dostat vymyšlený popis. Prázdný řetězec je správná odpověď:
// volající pak nechá původní technický tvar a nic si nedomýšlí.
func TestExplainIsEmptyForUnknownCode(t *testing.T) {
	if got := Explain("tenhle_kod_v_katalogu_neni"); got != "" {
		t.Fatalf("Explain u neznámého kódu = %q, chci prázdný řetězec", got)
	}
}

// Vysvětlení se smí psát jen ke kódu, který katalog zná. Věta u překlepu
// v konstantě by se nikdy neukázala a nikdo by si toho nevšiml.
func TestExplainHasNoEntryForUnknownCode(t *testing.T) {
	for code := range explanations {
		if Class(code) == ClassUnknown {
			t.Errorf("vysvětlení je u kódu %q, který katalog nezná", code)
		}
	}
}
