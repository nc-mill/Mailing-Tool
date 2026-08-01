package liquidx

import (
	"encoding/json"
	"testing"
	"time"
)

func dateFilter(t *testing.T, zone string) func(any, string) string {
	t.Helper()
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatal(err)
	}
	return makeDateFilter(loc)
}

func TestDateFilterWhitelistedFormats(t *testing.T) {
	f := dateFilter(t, "Europe/Prague")
	in := "2026-08-01T12:40:00Z"
	cases := []struct{ format, want string }{
		{"%d.%m.%Y", "01.08.2026"},
		{"%-d.%-m.%Y", "1.8.2026"},
		{"%Y-%m-%d", "2026-08-01"},
		{"%d.%m.%Y %H:%M", "01.08.2026 14:40"},
		{"%H:%M", "14:40"},
	}
	for _, c := range cases {
		if got := f(in, c.format); got != c.want {
			t.Errorf("%s: got %q, chci %q", c.format, got, c.want)
		}
	}
}

// Nepaddovaná varianta je jediné místo, kde se implementace může rozejít
// s TypeScriptem, protože time.Format ji neumí a skládá se ručně.
func TestDateFilterUnpaddedSingleDigits(t *testing.T) {
	f := dateFilter(t, "Europe/Prague")
	if got := f("2026-08-01T06:05:00Z", "%-d.%-m.%Y"); got != "1.8.2026" {
		t.Fatalf("got %q, chci 1.8.2026", got)
	}
}

// Vstupem může být RFC 3339 řetězec, celé číslo unixových sekund, nebo "now".
// Cokoliv jiného je prázdný řetězec.
func TestDateFilterAcceptedInputs(t *testing.T) {
	f := dateFilter(t, "UTC")
	if got := f(json.Number("1785000000"), "%Y-%m-%d"); got != "2026-07-25" {
		t.Errorf("unix sekundy: got %q", got)
	}
	if got := f("now", "%Y-%m-%d"); got != time.Now().UTC().Format("2006-01-02") {
		t.Errorf("now: got %q", got)
	}
	for _, bad := range []any{nil, true, []any{"a"}, "not a date", map[string]any{}} {
		if got := f(bad, "%Y-%m-%d"); got != "" {
			t.Errorf("%v: got %q, chci prázdný řetězec", bad, got)
		}
	}
}

// Žádná varianta nesmí vrátit chybu. Chyba filtru by shodila celý render
// a zpráva by skončila jako render_failed, přestože kontrakt pro neplatný vstup
// předepisuje prázdný řetězec.
func TestDateFilterNeverReturnsError(t *testing.T) {
	f := dateFilter(t, "UTC")
	if got := f("úplný nesmysl", "%Y-%m-%d"); got != "" {
		t.Fatalf("got %q", got)
	}
	if got := f("2026-08-01T12:40:00Z", "%neplatný"); got != "" {
		t.Fatalf("neznámý formát: got %q, chci prázdný řetězec", got)
	}
}

// Zóna se aplikuje před formátováním a bere se z engine, ne z bindings.
func TestDateFilterAppliesEngineTimezone(t *testing.T) {
	if got := dateFilter(t, "UTC")("2026-08-01T12:40:00Z", "%H:%M"); got != "12:40" {
		t.Errorf("UTC: got %q", got)
	}
	if got := dateFilter(t, "Europe/Prague")("2026-08-01T12:40:00Z", "%H:%M"); got != "14:40" {
		t.Errorf("Praha: got %q", got)
	}
}
